import { assertEquals, assertThrows } from "@std/assert";
import { resolveServer } from "./server_workflow.ts";

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
  await t.step("both match case-insensitively", () => {
    assertEquals(
      resolveServer(
        "My-Org",
        "Server",
        "my-org/server/.github/workflows/securefix.yaml@main",
      ).repo,
      "server",
    );
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
