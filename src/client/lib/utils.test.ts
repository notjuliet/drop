/// <reference types="bun" />

import { afterEach, describe, expect, test } from "bun:test";

import { formatBytes, formatExpiry, getExt } from "./utils";

const realDateNow = Date.now;

afterEach(() => {
  Date.now = realDateNow;
});

describe("utils", () => {
  test("extracts lowercase file extensions", () => {
    expect(getExt("photo.JPG")).toBe("jpg");
    expect(getExt("archive.tar.gz")).toBe("gz");
    expect(getExt("README")).toBe("");
  });

  test("formats byte counts for display", () => {
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1530)).toBe("1.5 KB");
    expect(formatBytes(2_500_000)).toBe("2.5 MB");
    expect(formatBytes(1_234_000_000)).toBe("1.23 GB");
  });

  test("formats expiry relative to the current time", () => {
    Date.now = () => 1_700_000_000_000;

    expect(formatExpiry(1_700_000_030)).toBe("expires in less than a minute");
    expect(formatExpiry(1_700_000_120)).toBe("expires in 2 minutes");
    expect(formatExpiry(1_700_003_600)).toBe("expires in 1 hour");
    expect(formatExpiry(1_700_172_800)).toBe("expires in 2 days");
  });
});
