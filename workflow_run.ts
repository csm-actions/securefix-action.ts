export type WorkflowRun = {
  id: number;
  url: string;
};

/**
 * Reads the workflow run from the response body of the workflow_dispatch API
 * with return_run_details.
 *
 * It returns undefined when the body doesn't have the run details,
 * e.g. 204 No Content returned by GitHub Enterprise Server which doesn't
 * support return_run_details.
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
