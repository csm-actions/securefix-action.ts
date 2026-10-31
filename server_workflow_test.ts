import { assertEquals, assertThrows } from "@std/assert";
import {
  parseWorkflowRef,
  parseWorkflowRun,
  resolveServer,
} from "./server_workflow.ts";

Deno.test("parseWorkflowRef", async (t) => {
  await t.step("branch", () => {
    assertEquals(
      parseWorkflowRef("foo/server/.github/workflows/securefix.yaml@main"),
      { owner: "foo", repo: "server", workflow: "securefix.yaml", ref: "main" },
    );
  });
  await t.step("full ref", () => {
    assertEquals(
      parseWorkflowRef(
        "foo/server/.github/workflows/securefix.yaml@refs/heads/main",
      ),
      {
        owner: "foo",
        repo: "server",
        workflow: "securefix.yaml",
        ref: "refs/heads/main",
      },
    );
  });
  await t.step("invalid", () => {
    for (
      const s of [
        "",
        "foo/server",
        "foo/server/.github/workflows/securefix.yaml",
        "foo/server/securefix.yaml@main",
        "foo/server/.github/workflows/@main",
        "foo/server/.github/workflows/dir/securefix.yaml@main",
      ]
    ) {
      assertThrows(() => parseWorkflowRef(s), Error, undefined, s);
    }
  });
});

Deno.test("resolveServer", async (t) => {
  const ref = "foo/server/.github/workflows/securefix.yaml@main";
  const workflowRef = {
    owner: "foo",
    repo: "server",
    workflow: "securefix.yaml",
    ref: "main",
  };
  await t.step("label", () => {
    assertEquals(resolveServer("foo", "server", undefined), {
      owner: "foo",
      repo: "server",
    });
  });
  await t.step("workflow ref only", () => {
    assertEquals(resolveServer("foo", undefined, ref), {
      owner: "foo",
      repo: "server",
      workflowRef,
    });
  });
  await t.step("another owner", () => {
    assertEquals(
      resolveServer(
        "bar",
        "",
        "foo/server/.github/workflows/securefix.yaml@main",
      ).owner,
      "foo",
    );
  });
  await t.step("both match", () => {
    assertEquals(resolveServer("foo", "server", ref), {
      owner: "foo",
      repo: "server",
      workflowRef,
    });
  });
  await t.step("repository mismatch", () => {
    assertThrows(() => resolveServer("foo", "other", ref));
  });
  await t.step("owner mismatch", () => {
    assertThrows(() => resolveServer("bar", "server", ref));
  });
  await t.step("neither", () => {
    assertThrows(() => resolveServer("foo", undefined, undefined));
    assertThrows(() => resolveServer("foo", "", ""));
  });
});

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
