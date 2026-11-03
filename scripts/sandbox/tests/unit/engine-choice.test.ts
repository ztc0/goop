import { describe, expect, test } from "bun:test";
import { chooseEngine, DOCKER_WARNING } from "../../model/engine-choice";

describe("chooseEngine (S3)", () => {
  test("--engine podman uses Podman, with no warning", () => {
    expect(chooseEngine("podman", ["podman", "docker"])).toEqual({ engine: "podman" });
    expect(chooseEngine("podman", ["podman"])).toEqual({ engine: "podman" });
  });

  test("--engine docker uses Docker, with the storage warning", () => {
    expect(DOCKER_WARNING).toBe(
      "Using Docker: its images and containers live in Docker's own storage (usually /var/lib/docker), outside this repository.",
    );
    expect(chooseEngine("docker", ["podman", "docker"])).toEqual({
      engine: "docker",
      warning: DOCKER_WARNING,
    });
  });

  test("without --engine, Podman wins when both are installed", () => {
    expect(chooseEngine(undefined, ["docker", "podman"])).toEqual({ engine: "podman" });
  });

  test("without --engine, Podman is used when it is the only one", () => {
    expect(chooseEngine(undefined, ["podman"])).toEqual({ engine: "podman" });
  });

  test("without --engine, Docker is used with the warning when it is the only one", () => {
    expect(chooseEngine(undefined, ["docker"])).toEqual({
      engine: "docker",
      warning: DOCKER_WARNING,
    });
  });

  test("with no engine installed it names what to install", () => {
    const error = { error: "No container engine found. Install Podman (recommended) or Docker." };
    expect(chooseEngine(undefined, [])).toEqual(error);
  });

  test("a requested engine that is not installed is an error, even when the other one is", () => {
    expect(chooseEngine("docker", ["podman"])).toEqual({
      error: "--engine docker was requested, but docker is not installed.",
    });
    expect(chooseEngine("podman", [])).toEqual({
      error: "--engine podman was requested, but podman is not installed.",
    });
  });
});
