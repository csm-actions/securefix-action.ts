import * as fs from "node:fs";
import * as path from "node:path";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { DefaultArtifactClient } from "@actions/artifact";
import type * as githubAppToken from "@suzuki-shunsuke/github-app-token";
import * as dispatch from "@csm-actions/dispatch";
import * as label from "@csm-actions/label";
import { listFixedFiles, normalizeFixedFile } from "./list_fixed_files.ts";
import { resolveServer } from "./server_workflow.ts";
import { getSubmoduleSHA } from "./submodule.ts";
import { isTracked } from "./git_index.ts";
import { isUnderSymlink, readSymlink, type Symlink } from "./symlink.ts";

export type { WorkflowRun } from "@csm-actions/dispatch";

export type PullRequest = {
  title: string;
  body?: string;
  base: string;
  labels?: string[];
  assignees?: string[];
  reviewers?: string[];
  team_reviewers?: string[];
  draft?: boolean;
  comment?: string;
  automerge_method?: string;
  project?: {
    number?: number;
    owner: string;
    id?: string;
  };
  milestone_number?: number;
};

export type Inputs = {
  /**
   * An Octokit client authenticated as a GitHub App.
   *
   * It's used to create an installation access token for the server
   * repository, which is revoked once the request is sent.
   * The token needs the `actions:write` permission with serverWorkflowRef
   * (workflow_dispatch), or the `issues:write` permission without it (label).
   * Build it with @octokit/auth-app, passing either a private key or a
   * createJwt callback when the key is stored in a KMS or a HSM.
   */
  appOctokit: githubAppToken.Client;
  /**
   * The server workflow to run by a workflow_dispatch event, in the format
   * `<owner>/<repo>/.github/workflows/<workflow file>@<ref>`,
   * e.g. `my-org/securefix-server/.github/workflows/securefix.yaml@main`.
   *
   * When it's set, the server workflow is run by a workflow_dispatch event,
   * which requires the `actions:write` permission of the server repository.
   * Otherwise a label is created in the server repository to trigger the
   * server workflow, which requires the `issues:write` permission.
   */
  serverWorkflowRef?: string;
  // rootDir is a path to the root directory.
  // It must be a relative path from a git root directory.
  rootDir?: string;
  /**
   * The server repository name in the client's owner.
   * It can be omitted when serverWorkflowRef is set. If both are set, they must
   * point to the same repository.
   */
  serverRepository?: string;
  repo?: string;
  branch?: string;
  failIfChanges?: boolean;
  // files is a set of relative file paths from rootDir to fixed files.
  files?: Set<string>;
  pr?: PullRequest;
  commitMessage: string;
  workspace: string;
  useGit?: boolean;
  custom?: unknown;
};

export type Result = {
  /**
   * The name of the uploaded artifact.
   * It's empty if no artifact is uploaded, i.e. there are no changes.
   * It's set even if only submodules are updated, in which case changedFiles
   * is empty.
   */
  artifactName: string;
  /**
   * The server workflow run, which is set only when serverWorkflowRef is set
   * and GitHub returns the run details.
   */
  serverWorkflowRun?: dispatch.WorkflowRun;
  changedFiles: string[];
  changedFilesFromRootDir: string[];
};

type AutomergeMethod = "" | "merge" | "squash" | "rebase";

const validateAutomergeMethod = (method: string): AutomergeMethod => {
  if (!["", "merge", "squash", "rebase"].includes(method)) {
    throw new Error(
      'automerge_method must be one of "", "merge", "squash", or "rebase"',
    );
  }
  return method as AutomergeMethod;
};

const generateArtifactName = (): string => {
  return label.newName("securefix-");
};

export const request = async (inputs: Inputs): Promise<Result> => {
  // Validate the server before uploading an artifact.
  const server = resolveServer(
    github.context.repo.owner,
    inputs.serverRepository,
    inputs.serverWorkflowRef,
  );
  if (inputs.pr) {
    validatePR(inputs.pr);
  }
  if (inputs.useGit === false && (!inputs.files || inputs.files.size === 0)) {
    throw new Error("files is required when useGit is false");
  }
  const artifactName = generateArtifactName();

  const allFixedFiles = inputs.useGit === false
    ? inputs.files!
    : await listFixedFiles(inputs.rootDir ?? "", inputs.files ?? new Set());
  if (allFixedFiles.size === 0) {
    core.notice("No changes");
    return {
      artifactName: "",
      changedFiles: [],
      changedFilesFromRootDir: [],
    };
  }

  // Separate submodule paths from regular files
  const submodules: Array<{ path: string; sha: string }> = [];
  // Symlinks are sent in the metadata file, not as files.
  // See readSymlink for details.
  const symlinks: Symlink[] = [];
  const fixedFilesFromRootDir = new Set<string>();
  // Files under a symlinked directory are deleted from Git's point of view.
  // They are listed in _files.txt but not uploaded, so the server deletes them.
  // They are kept apart from fixedFilesFromRootDir, because fs.existsSync
  // follows the symlink and could find files in the link target.
  const filesUnderSymlink: string[] = [];
  // Paths of files, symlinks, or submodules replaced with directories.
  // They are sent in the metadata file and deleted explicitly by the server,
  // because the Create a tree API can't add files under them otherwise, and
  // the server can't tell they are deleted as they exist as directories.
  const deletedFiles: string[] = [];
  const baseDir = path.join(inputs.workspace, inputs.rootDir ?? "");
  // Different paths can be normalized to the same path, e.g. "sub" and "sub/"
  const normalizedFiles = new Set<string>();
  for (const listedFile of allFixedFiles) {
    const file = normalizeFixedFile(listedFile);
    if (normalizedFiles.has(file)) {
      continue;
    }
    normalizedFiles.add(file);
    const fullPath = path.join(baseDir, file);
    if (isUnderSymlink(baseDir, file)) {
      core.info(`Detected a file under a symlink, which is deleted: ${file}`);
      filesUnderSymlink.push(file);
      continue;
    }
    const target = readSymlink(fullPath);
    if (target !== undefined) {
      core.info(`Detected symlink: ${file} -> ${target}`);
      symlinks.push({ path: file, target });
      continue;
    }
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
      const sha = await getSubmoduleSHA(fullPath);
      if (!sha) {
        // Git lists a regular directory only when a file, a symlink, or a
        // submodule is replaced with it. Files in the directory are listed
        // separately.
        if (!(await isTracked(baseDir, file))) {
          // e.g. a directory specified in files with useGit: false
          throw new Error(
            `${file} is a directory but neither a submodule nor a tracked path replaced with a directory. ` +
              "If you specified it in files, specify files in it instead",
          );
        }
        core.info(
          `Detected a directory which replaced a tracked path, which is deleted: ${file}`,
        );
        deletedFiles.push(file);
        continue;
      }
      core.info(`Detected submodule: ${file} (${sha})`);
      submodules.push({ path: file, sha });
    } else {
      fixedFilesFromRootDir.add(file);
    }
  }

  if (
    fixedFilesFromRootDir.size === 0 && filesUnderSymlink.length === 0 &&
    deletedFiles.length === 0 && submodules.length === 0 &&
    symlinks.length === 0
  ) {
    core.notice("No changes");
    return {
      artifactName: "",
      changedFiles: [],
      changedFilesFromRootDir: [],
    };
  }

  const txtPath = path.join(inputs.rootDir ?? "", `${artifactName}_files.txt`);
  const jsonPath = path.join(inputs.rootDir ?? "", `${artifactName}.json`);

  createMetadataFile(inputs, submodules, symlinks, deletedFiles, jsonPath);
  fs.writeFileSync(
    txtPath,
    [...fixedFilesFromRootDir, ...filesUnderSymlink].join("\n") + "\n",
  );

  // Exclude deleted files from upload (they are still listed in _files.txt)
  const uploadFiles = [...fixedFilesFromRootDir]
    .filter((file) => fs.existsSync(path.join(baseDir, file)))
    .map((file) => path.join(inputs.rootDir ?? "", file));

  // upload artifact
  const artifact = new DefaultArtifactClient();
  await artifact.uploadArtifact(
    artifactName,
    uploadFiles.concat(jsonPath, txtPath),
    baseDir,
  );
  fs.rmSync(txtPath);
  fs.rmSync(jsonPath);
  let serverWorkflowRun: dispatch.WorkflowRun | undefined;
  if (server.workflowRef) {
    serverWorkflowRun = await dispatch.dispatch({
      appOctokit: inputs.appOctokit,
      workflowRef: server.workflowRef,
      inputs: {
        client_repository_owner: github.context.repo.owner,
        client_repository_name: github.context.repo.repo,
        client_workflow_run_id: `${github.context.runId}`,
        artifact_name: artifactName,
      },
    });
  } else {
    await label.create({
      appOctokit: inputs.appOctokit,
      owner: server.owner,
      repo: server.repo,
      name: artifactName,
      description:
        `${github.context.repo.owner}/${github.context.repo.repo}/${github.context.runId}`,
    });
  }
  if (inputs.failIfChanges || (!inputs.repo && !inputs.branch)) {
    core.setFailed("Changes detected. A commit will be pushed");
  } else {
    core.notice("Changes detected. A commit will be pushed");
  }
  const changedFilesFromRootDir = [
    ...fixedFilesFromRootDir,
    ...filesUnderSymlink,
    ...deletedFiles,
    ...symlinks.map((symlink) => symlink.path),
  ];
  const changedFiles = changedFilesFromRootDir.map((file) =>
    path.join(inputs.rootDir ?? "", file)
  );
  core.info(changedFiles.join("\n"));
  return {
    artifactName,
    serverWorkflowRun,
    changedFiles,
    changedFilesFromRootDir,
  };
};

const validatePR = (pr: PullRequest) => {
  if (pr.title !== "") {
    return;
  }
  if (pr?.automerge_method) {
    validateAutomergeMethod(pr?.automerge_method);
  }
  if (
    pr.base ||
    pr.body ||
    pr.labels?.length ||
    pr.assignees?.length ||
    pr.reviewers?.length ||
    pr.team_reviewers?.length ||
    pr.draft ||
    pr.comment ||
    pr.milestone_number ||
    pr.project ||
    pr.automerge_method
  ) {
    throw new Error("title is required to create a pull request");
  }
};

const createMetadataFile = (
  inputs: Inputs,
  submodules: Array<{ path: string; sha: string }>,
  symlinks: Symlink[],
  deletedFiles: string[],
  filePath: string,
) => {
  const value = {
    context: github.context,
    inputs: {
      repository: inputs.repo,
      branch: inputs.branch,
      commit_message: inputs.commitMessage,
      root_dir: inputs.rootDir,
      pull_request: inputs.pr,
      custom: inputs.custom,
      submodules: submodules.length > 0 ? submodules : undefined,
      symlinks: symlinks.length > 0 ? symlinks : undefined,
      deleted_files: deletedFiles.length > 0 ? deletedFiles : undefined,
    },
  };
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
};
