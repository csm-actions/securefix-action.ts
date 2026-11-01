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
  // Add the input names to the errors of the library, which doesn't know them.
  let workflowRef: WorkflowRef;
  try {
    workflowRef = parseWorkflowRef(serverWorkflowRef);
  } catch (error) {
    throw new Error(`serverWorkflowRef is invalid: ${message(error)}`, {
      cause: error,
    });
  }
  if (serverRepository) {
    try {
      validateRepository(workflowRef, clientOwner, serverRepository);
    } catch (error) {
      throw new Error(
        `serverRepository and serverWorkflowRef must point to the same repository: ${
          message(error)
        }`,
        { cause: error },
      );
    }
  }
  return { owner: workflowRef.owner, repo: workflowRef.repo, workflowRef };
};

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
