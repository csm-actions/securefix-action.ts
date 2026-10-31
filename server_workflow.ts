export type WorkflowRun = {
  id: number;
  url: string;
};

export type WorkflowRef = {
  owner: string;
  repo: string;
  /** The workflow file name, e.g. `securefix.yaml` */
  workflow: string;
  /**
   * A branch or tag name, or a full ref such as `refs/heads/main`.
   * A commit SHA isn't allowed because the workflow_dispatch API doesn't
   * accept it.
   */
  ref: string;
};

/**
 * Where a request is sent.
 * workflowRef is set when the server workflow is run by workflow_dispatch,
 * otherwise a label is created in owner/repo.
 */
export type Server = {
  owner: string;
  repo: string;
  workflowRef?: WorkflowRef;
};

// The ref can contain "@" because git allows it in branch names,
// but it can't contain whitespace.
const workflowRefPattern =
  /^([^/@\s]+)\/([^/@\s]+)\/\.github\/workflows\/([^/@\s]+\.ya?ml)@(\S+)$/;

const commitSHAPattern = /^[0-9a-f]{40}$/i;

/**
 * Parses a workflow ref in the format
 * `<owner>/<repo>/.github/workflows/<workflow file>@<ref>`,
 * the same format as `github.workflow_ref`.
 * Unlike `uses` of reusable workflows, the ref must be a branch or tag,
 * not a commit SHA, because the workflow_dispatch API accepts only them.
 */
export const parseWorkflowRef = (s: string): WorkflowRef => {
  const m = workflowRefPattern.exec(s);
  if (!m) {
    throw new Error(
      `serverWorkflowRef must be in the format <owner>/<repo>/.github/workflows/<workflow file>@<branch or tag>, got ${s}`,
    );
  }
  if (commitSHAPattern.test(m[4])) {
    throw new Error(
      `the ref of serverWorkflowRef must be a branch or tag, not a commit SHA, because the workflow_dispatch API doesn't accept it: ${s}`,
    );
  }
  return { owner: m[1], repo: m[2], workflow: m[3], ref: m[4] };
};

/**
 * Works out where a request is sent.
 *
 * serverRepository is a repository name in the client's owner.
 * When serverWorkflowRef is set, serverRepository can be omitted, and if both
 * are set they must point to the same repository.
 */
export const resolveServer = (
  clientOwner: string,
  serverRepository: string | undefined,
  serverWorkflowRef: string | undefined,
): Server => {
  if (!serverWorkflowRef) {
    if (!serverRepository) {
      throw new Error(
        "Either serverRepository or serverWorkflowRef is required",
      );
    }
    return { owner: clientOwner, repo: serverRepository };
  }
  const workflowRef = parseWorkflowRef(serverWorkflowRef);
  // GitHub owner and repository names are case-insensitive.
  if (
    serverRepository &&
    (workflowRef.owner.toLowerCase() !== clientOwner.toLowerCase() ||
      workflowRef.repo.toLowerCase() !== serverRepository.toLowerCase())
  ) {
    throw new Error(
      `serverRepository ${clientOwner}/${serverRepository} doesn't match the repository of serverWorkflowRef ${workflowRef.owner}/${workflowRef.repo}`,
    );
  }
  return { owner: workflowRef.owner, repo: workflowRef.repo, workflowRef };
};

/**
 * Reads the workflow run from the response body of the workflow_dispatch API
 * with return_run_details.
 *
 * It returns undefined when the body doesn't have the run details.
 */
export const parseWorkflowRun = (data: unknown): WorkflowRun | undefined => {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }
  const d = data as Record<string, unknown>;
  if (typeof d.workflow_run_id !== "number" || typeof d.html_url !== "string") {
    return undefined;
  }
  return { id: d.workflow_run_id, url: d.html_url };
};
