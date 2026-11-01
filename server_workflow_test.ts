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
  await t.step("full ref, .yml, and @ in the ref", () => {
    assertEquals(
      resolveServer(
        "foo",
        undefined,
        "foo/server/.github/workflows/securefix.yml@refs/heads/feat@1",
      ).workflowRef,
      {
        owner: "foo",
        repo: "server",
        workflow: "securefix.yml",
        ref: "refs/heads/feat@1",
      },
    );
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
    assertThrows(
      () => resolveServer("foo", "other", ref),
      Error,
      "serverRepository and serverWorkflowRef must point to the same repository",
    );
  });
  await t.step("owner mismatch", () => {
    assertThrows(
      () => resolveServer("bar", "server", ref),
      Error,
      "serverRepository and serverWorkflowRef must point to the same repository",
    );
  });
  await t.step("invalid workflow ref", () => {
    for (
      const s of [
        "foo/server",
        "foo/server/securefix.yaml@main",
        "foo/server/.github/workflows/securefix.yaml",
        "foo/server/.github/workflows/securefix.yaml@0123456789abcdef0123456789abcdef01234567",
      ]
    ) {
      assertThrows(
        () => resolveServer("foo", undefined, s),
        Error,
        "serverWorkflowRef is invalid",
        s,
      );
    }
  });
  await t.step("neither", () => {
    assertThrows(() => resolveServer("foo", undefined, undefined));
    assertThrows(() => resolveServer("foo", "", ""));
  });
});
