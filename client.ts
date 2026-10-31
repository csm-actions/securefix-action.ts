import * as fs from "node:fs";
import * as path from "node:path";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as github from "@actions/github";
import { DefaultArtifactClient } from "@actions/artifact";
import * as githubAppToken from "@suzuki-shunsuke/github-app-token";
import { newName } from "@csm-actions/label";
import { listFixedFiles } from "./list_fixed_files.ts";
import {
  parseWorkflowRun,
  resolveServer,
  type WorkflowRef,
  type WorkflowRun,
} from "./server_workflow.ts";

export type { WorkflowRun };

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
   * repository, which is revoked once the label is created.
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
  artifactName: string;
  /**
   * The server workflow run, which is set only when serverWorkflowRef is set
   * and GitHub returns the run details.
   */
  serverWorkflowRun?: WorkflowRun;
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
  return newName("securefix-");
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
      artifactName,
      changedFiles: [],
      changedFilesFromRootDir: [],
    };
  }

  // Separate submodule paths from regular files
  const submodules: Array<{ path: string; sha: string }> = [];
  const fixedFilesFromRootDir = new Set<string>();
  for (const file of allFixedFiles) {
    const fullPath = path.join(
      inputs.workspace,
      inputs.rootDir ?? "",
      file,
    );
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
      const result = await exec.getExecOutput(
        "git",
        ["-C", fullPath, "rev-parse", "HEAD"],
      );
      const sha = result.stdout.trim();
      if (sha) {
        core.info(`Detected submodule: ${file} (${sha})`);
        submodules.push({ path: file, sha });
      }
    } else {
      fixedFilesFromRootDir.add(file);
    }
  }

  if (fixedFilesFromRootDir.size === 0 && submodules.length === 0) {
    core.notice("No changes");
    return {
      artifactName,
      changedFiles: [],
      changedFilesFromRootDir: [],
    };
  }

  const txtPath = path.join(inputs.rootDir ?? "", `${artifactName}_files.txt`);
  const jsonPath = path.join(inputs.rootDir ?? "", `${artifactName}.json`);

  createMetadataFile(inputs, submodules, jsonPath);
  fs.writeFileSync(txtPath, [...fixedFilesFromRootDir].join("\n") + "\n");

  const fixedFiles = [...fixedFilesFromRootDir].map((file) =>
    path.join(inputs.rootDir ?? "", file)
  );

  // Exclude deleted files from upload (they are still listed in _files.txt)
  const uploadFiles = fixedFiles.filter((file) =>
    fs.existsSync(path.join(inputs.workspace, file))
  );

  // upload artifact
  const artifact = new DefaultArtifactClient();
  await artifact.uploadArtifact(
    artifactName,
    uploadFiles.concat(jsonPath, txtPath),
    path.join(inputs.workspace, inputs.rootDir ?? ""),
  );
  fs.rmSync(txtPath);
  fs.rmSync(jsonPath);
  let serverWorkflowRun: WorkflowRun | undefined;
  if (server.workflowRef) {
    serverWorkflowRun = await dispatchWorkflow(
      inputs.appOctokit,
      server.workflowRef,
      {
        client_repository_owner: github.context.repo.owner,
        client_repository_name: github.context.repo.repo,
        client_workflow_run_id: `${github.context.runId}`,
        artifact_name: artifactName,
      },
    );
  } else {
    await createLabel(
      inputs.appOctokit,
      server.owner,
      server.repo,
      artifactName,
      `${github.context.repo.owner}/${github.context.repo.repo}/${github.context.runId}`,
    );
  }
  if (inputs.failIfChanges || (!inputs.repo && !inputs.branch)) {
    core.setFailed("Changes detected. A commit will be pushed");
  } else {
    core.notice("Changes detected. A commit will be pushed");
  }
  core.info(fixedFiles.join("\n"));
  return {
    artifactName,
    serverWorkflowRun,
    changedFiles: fixedFiles || [],
    changedFilesFromRootDir: [...fixedFilesFromRootDir],
  };
};

/**
 * Creates an installation access token for the server repository, passes it
 * to fn, and revokes it afterwards.
 */
const withServerToken = async <T>(
  appOctokit: githubAppToken.Client,
  owner: string,
  repo: string,
  permissions: githubAppToken.Permissions,
  fn: (octokit: ReturnType<typeof github.getOctokit>) => Promise<T>,
): Promise<T> => {
  const token = await githubAppToken.create({
    octokit: appOctokit,
    owner: owner,
    repositories: [repo],
    permissions: permissions,
  });
  // Without this the token would appear in the workflow log.
  core.setSecret(token.token);
  try {
    return await fn(github.getOctokit(token.token));
  } finally {
    // The request is sent, so the token has done its job either way.
    if (githubAppToken.hasExpired(token.expiresAt)) {
      core.info("GitHub App token has already expired");
    } else {
      core.info("Revoking GitHub App token");
      await githubAppToken.revoke(token.token);
    }
  }
};

const createLabel = async (
  appOctokit: githubAppToken.Client,
  owner: string,
  repo: string,
  labelName: string,
  description: string,
): Promise<void> => {
  await withServerToken(
    appOctokit,
    owner,
    repo,
    { issues: "write" },
    async (octokit) => {
      await octokit.rest.issues.createLabel({
        owner: owner,
        repo: repo,
        name: labelName,
        description: description,
      });
    },
  );
};

/**
 * Runs the server workflow by a workflow_dispatch event.
 *
 * It returns the server workflow run if GitHub returns the run details,
 * otherwise undefined.
 */
const dispatchWorkflow = async (
  appOctokit: githubAppToken.Client,
  workflowRef: WorkflowRef,
  workflowInputs: Record<string, string>,
): Promise<WorkflowRun | undefined> => {
  core.info(
    `running the server workflow: ${
      JSON.stringify({ ...workflowRef, inputs: workflowInputs })
    }`,
  );
  return await withServerToken(
    appOctokit,
    workflowRef.owner,
    workflowRef.repo,
    { actions: "write" },
    async (octokit) => {
      const res = await octokit.rest.actions.createWorkflowDispatch({
        owner: workflowRef.owner,
        repo: workflowRef.repo,
        workflow_id: workflowRef.workflow,
        ref: workflowRef.ref,
        inputs: workflowInputs,
        return_run_details: true,
      });
      // The endpoint types of @actions/github don't know the response with
      // the run details, so the body is read defensively.
      const run = parseWorkflowRun(res.data);
      if (run) {
        core.notice(`The server workflow run: ${run.url}`);
      }
      return run;
    },
  );
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
    },
  };
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
};
