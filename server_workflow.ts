import {
  parseWorkflowRef,
  validateRepository,
  type WorkflowRef,
} from "@csm-actions/dispatch";

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
  if (serverRepository) {
    validateRepository(workflowRef, clientOwner, serverRepository);
  }
  return { owner: workflowRef.owner, repo: workflowRef.repo, workflowRef };
};
