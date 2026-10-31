import { assertEquals } from "@std/assert";
import { parseWorkflowRun } from "./workflow_run.ts";

Deno.test("parseWorkflowRun", async (t) => {
  await t.step("run details", () => {
    assertEquals(
      parseWorkflowRun({
        workflow_run_id: 123,
        run_url: "https://api.github.com/repos/foo/bar/actions/runs/123",
        html_url: "https://github.com/foo/bar/actions/runs/123",
      }),
      { id: 123, url: "https://github.com/foo/bar/actions/runs/123" },
    );
  });
  await t.step("no content", () => {
    assertEquals(parseWorkflowRun(undefined), undefined);
    assertEquals(parseWorkflowRun(""), undefined);
    assertEquals(parseWorkflowRun(null), undefined);
  });
  await t.step("unexpected body", () => {
    assertEquals(parseWorkflowRun({ html_url: "x" }), undefined);
    assertEquals(
      parseWorkflowRun({ workflow_run_id: "1", html_url: "x" }),
      undefined,
    );
  });
});
