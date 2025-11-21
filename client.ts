import * as fs from "node:fs";
import * as path from "node:path";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as github from "@actions/github";
import { DefaultArtifactClient } from "@actions/artifact";
import * as githubAppToken from "@suzuki-shunsuke/github-app-token";
import { newName } from "@csm-actions/label";

const nowS = (): string => {
  const date = new Date();
  const pad = (n: number): string => n.toString().padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yyyy}${mm}${dd}${hh}${min}${ss}`;
};

type PullRequest = {
  title: string;
  body: string;
  base: string;
  labels: string[];
  assignees: string[];
  reviewers: string[];
  team_reviewers: string[];
  draft: boolean;
  comment: string;
  automerge_method: string;
  project: {
    number: number;
    owner: string;
    id?: string;
  } | null;
  milestone_number?: number;
};

type Inputs = {
  appId: string;
  privateKey: string;
  // rootDir is a path to the root directory.
  // It must be a relative path from a git root directory.
  rootDir: string;
  serverRepository: string;
  repo: string;
  branch: string;
  failIfChanges: boolean;
  // files is a set of file paths from rootDir
  files: Set<string>;
  pr: PullRequest;
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
  return newName(`securefix-${nowS()}-`);
};

const listFixedFiles = async (rootDir: string): Promise<Set<string>> => {
  // fixedFiles is a set of file paths from rootDir
  // List fixed files
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
  validateAutomergeMethod(inputs.pr.automerge_method);
  validatePR(inputs.pr);
  const artifactName = generateArtifactName();
  const fixedFilesFromRootDir = await listFixedFiles(inputs.rootDir);
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
    path.join(inputs.rootDir, file)
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

type Files = {
  changedFilesFromRootDir?: string[];
  changedFiles?: string[];
};

const filterFiles = (
  fixedFiles: Set<string>,
  files: Set<string>,
): string[] => {
  if (files.size === 0) {
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
  if (
    pr.base ||
    pr.body ||
    pr.labels.length > 0 ||
    pr.assignees.length > 0 ||
    pr.reviewers.length > 0 ||
    pr.team_reviewers.length > 0 ||
    pr.draft ||
    pr.comment ||
    pr.milestone_number ||
    pr.project ||
    pr.automerge_method
  ) {
    throw new Error("pull_request_title is required to create a pull request");
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
