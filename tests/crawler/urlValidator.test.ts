import { describe, expect, it } from "vitest";
import { isBlockedIp } from "../../apps/functions/src/fetcher/ipGuard.js";
import {
  defaultUrlPolicy,
  UrlValidationError,
  validateUrl,
} from "../../apps/functions/src/fetcher/urlValidator.js";

const reasonOf = (raw: string, policy = defaultUrlPolicy): string | undefined => {
  try {
    validateUrl(raw, policy);
    return undefined;
  } catch (e) {
    return e instanceof UrlValidationError ? e.reason : "OTHER";
  }
};

describe("validateUrl", () => {
  it("accepts public http(s) URLs and strips fragments", () => {
    expect(validateUrl("https://example.com/a?b=1#frag").toString()).toBe(
      "https://example.com/a?b=1",
    );
    expect(reasonOf("http://example.com")).toBeUndefined();
    expect(reasonOf("https://sub.example.co.uk:443/")).toBeUndefined();
  });

  it.each([
    ["file:///etc/passwd", "SCHEME_NOT_ALLOWED"],
    ["ftp://example.com/", "SCHEME_NOT_ALLOWED"],
    ["gopher://example.com/", "SCHEME_NOT_ALLOWED"],
    ["data:text/html,hi", "SCHEME_NOT_ALLOWED"],
    ["javascript:alert(1)", "SCHEME_NOT_ALLOWED"],
    ["not a url", "INVALID_URL"],
    ["", "INVALID_URL"],
    ["https://user:pw@example.com/", "CREDENTIALS_NOT_ALLOWED"],
    ["https://example.com:8443/", "PORT_NOT_ALLOWED"],
    ["http://example.com:22/", "PORT_NOT_ALLOWED"],
  ])("rejects %s", (raw, reason) => {
    expect(reasonOf(raw)).toBe(reason);
  });

  it.each([
    "http://localhost/",
    "http://LOCALHOST./",
    "http://foo.localhost/",
    "http://printer.local/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://intranet/",
    "http://router.lan/",
  ])("rejects internal hostname %s", (raw) => {
    expect(reasonOf(raw)).toBe("HOST_NOT_ALLOWED");
  });

  it.each([
    "http://127.0.0.1/",
    "http://127.1/",
    "http://2130706433/", // dezimal
    "http://0x7f.0.0.1/", // hex
    "http://0177.0.0.1/", // oktal
    "http://0.0.0.0/",
    "http://10.1.2.3/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://100.64.0.1/",
    "http://[::1]/",
    "http://[::]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:a9fe:a9fe]/", // 169.254.169.254 gemappt
    "http://[fd00:ec2::254]/",
    "http://[fe80::1]/",
    "http://[fc00::1]/",
  ])("rejects private/special IP %s", (raw) => {
    expect(reasonOf(raw)).toBe("IP_NOT_ALLOWED");
  });

  it("accepts public IP literals on allowed ports", () => {
    expect(reasonOf("http://8.8.8.8/")).toBeUndefined();
    expect(reasonOf("https://[2606:4700:4700::1111]/")).toBeUndefined();
  });

  it("enforces optional domain allowlist incl. subdomains", () => {
    const policy = { ...defaultUrlPolicy, domainAllowlist: ["example.com"] };
    expect(reasonOf("https://example.com/", policy)).toBeUndefined();
    expect(reasonOf("https://www.example.com/", policy)).toBeUndefined();
    expect(reasonOf("https://notexample.com/", policy)).toBe("DOMAIN_NOT_ALLOWLISTED");
    expect(reasonOf("https://example.com.evil.io/", policy)).toBe("DOMAIN_NOT_ALLOWLISTED");
  });

  it("rejects overly long URLs", () => {
    expect(reasonOf(`https://example.com/${"a".repeat(2100)}`)).toBe("INVALID_URL");
  });
});

describe("isBlockedIp", () => {
  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"])
      expect(isBlockedIp(ip), ip).toBe(false);
  });
  it("blocks mapped, NAT64, 6to4 and unparsable input (fail closed)", () => {
    for (const ip of [
      "::ffff:7f00:1",
      "::ffff:10.0.0.1",
      "64:ff9b::7f00:1",
      "2002:7f00:1::",
      "garbage",
      "",
      "999.1.1.1",
    ])
      expect(isBlockedIp(ip), ip).toBe(true);
  });
  it("handles boundaries of 172.16/12", () => {
    expect(isBlockedIp("172.15.255.255")).toBe(false);
    expect(isBlockedIp("172.16.0.0")).toBe(true);
    expect(isBlockedIp("172.32.0.0")).toBe(false);
  });
});
