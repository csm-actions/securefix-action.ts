import * as fs from "node:fs";
import * as path from "node:path";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as github from "@actions/github";
import { DefaultArtifactClient } from "@actions/artifact";
import * as githubAppToken from "@suzuki-shunsuke/github-app-token";
import { newName } from "@csm-actions/label";

type PullRequest = {
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

type Inputs = {
  appId: string;
  privateKey: string;
  // rootDir is a path to the root directory.
  // It must be a relative path from a git root directory.
  rootDir?: string;
  serverRepository: string;
  repo?: string;
  branch?: string;
  failIfChanges?: boolean;
  // files is a set of relative file paths from rootDir to fixed files.
  files?: Set<string>;
  pr?: PullRequest;
  commitMessage: string;
  workspace: string;
};

type Result = {
  artifactName: string;
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

/**
 * listFixedFiles returns a set of relative file paths from rootDir to fixed files.
 */
const listFixedFiles = async (rootDir: string): Promise<Set<string>> => {
  const result = await exec.getExecOutput(
    "git",
    ["ls-files", "--modified", "--others", "--exclude-standard"],
    {
      cwd: rootDir || undefined,
    },
  );
  return new Set(
    result.stdout
      .trim()
      .split("\n")
      .filter((file) => file.length > 0),
  );
};

export const request = async (inputs: Inputs): Promise<Result> => {
  if (inputs.pr) {
    validatePR(inputs.pr);
  }
  const artifactName = generateArtifactName();
  const fixedFilesFromRootDir = await listFixedFiles(inputs.rootDir ?? "");
  if (fixedFilesFromRootDir.size === 0) {
    core.notice("No changes");
    return {
      artifactName,
      changedFiles: [],
      changedFilesFromRootDir: [],
    };
  }
  const filteredFixedFilesFromRootDir = filterFiles(
    fixedFilesFromRootDir,
    inputs.files,
  );
  if (filteredFixedFilesFromRootDir.length === 0) {
    core.notice("No changes");
    return {
      artifactName,
      changedFiles: [],
      changedFilesFromRootDir: [],
    };
  }

  createMetadataFile(artifactName, inputs);
  fs.writeFileSync(
    `${artifactName}_files.txt`,
    filteredFixedFilesFromRootDir.join("\n") + "\n",
  );

  const fixedFiles = filteredFixedFilesFromRootDir.map((file) =>
    path.join(inputs.rootDir ?? "", file)
  );

  // upload artifact
  const artifact = new DefaultArtifactClient();
  await artifact.uploadArtifact(
    artifactName,
    fixedFiles.concat(
      `${artifactName}.json`,
      `${artifactName}_files.txt`,
    ),
    inputs.workspace,
  );
  fs.rmSync(`${artifactName}_files.txt`);
  fs.rmSync(`${artifactName}.json`);
  await createLabel(
    {
      appId: inputs.appId,
      privateKey: inputs.privateKey,
      owner: github.context.repo.owner,
      repositories: [inputs.serverRepository],
      permissions: {
        issues: "write",
      },
    },
    artifactName,
    `${github.context.repo.owner}/${github.context.repo.repo}/${github.context.runId}`,
  );
  if (inputs.failIfChanges || (!inputs.repo && !inputs.branch)) {
    core.setFailed("Changes detected. A commit will be pushed");
    core.info(fixedFiles.join("\n"));
    return {
      artifactName,
      changedFiles: fixedFiles || [],
      changedFilesFromRootDir: filteredFixedFilesFromRootDir,
    };
  }
  core.notice("Changes detected. A commit will be pushed");
  core.info(fixedFiles.join("\n"));
  return {
    artifactName,
    changedFiles: fixedFiles || [],
    changedFilesFromRootDir: filteredFixedFilesFromRootDir || [],
  };
};

const filterFiles = (
  fixedFiles: Set<string>,
  files?: Set<string>,
): string[] => {
  if (!files?.size) {
    return [...fixedFiles];
  }
  return [...files].filter((file) => fixedFiles.has(file));
};

const createLabel = async (
  inputs: githubAppToken.Inputs,
  labelName: string,
  description: string,
) => {
  const token = await githubAppToken.create(inputs);
  try {
    const octokit = github.getOctokit(token.token);
    await octokit.rest.issues.createLabel({
      owner: inputs.owner,
      repo: inputs.repositories ? inputs.repositories[0] : "",
      name: labelName,
      description: description,
    });
  } catch (error) {
    if (githubAppToken.hasExpired(token.expiresAt)) {
      core.info("GitHub App token has already expired");
      return;
    }
    core.info("Revoking GitHub App token");
    await githubAppToken.revoke(token.token);
    throw error;
  }
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

const createMetadataFile = (labelName: string, inputs: Inputs) => {
  const value = {
    context: github.context,
    inputs: {
      repository: inputs.repo,
      branch: inputs.branch,
      commit_message: inputs.commitMessage,
      root_dir: inputs.rootDir,
      pull_request: inputs.pr,
    },
  };
  fs.writeFileSync(`${labelName}.json`, JSON.stringify(value, null, 2) + "\n");
};
