import { describe, expect, it } from "vitest";

import { sanitiseRichTemplateHtml } from "../src/lib/richTemplate";

describe("sanitiseRichTemplateHtml", () => {
  it("preserves the supported formatting grammar", () => {
    expect(
      sanitiseRichTemplateHtml(
        '<b>{title}</b><br><i>{description}</i> <a href="https://example.invalid/details">Details</a>',
      ),
    ).toBe(
      '<b>{title}</b><br><i>{description}</i> <a href="https://example.invalid/details">Details</a>',
    );
  });

  it.each([
    ['<img src=x onerror="window.pwned=true">', ""],
    ['<svg onload="window.pwned=true"><b>safe text</b></svg>', "<b>safe text</b>"],
    ['<a href="javascript:window.pwned=true">open</a>', "open"],
    ['<b onclick="window.pwned=true">bold</b>', "<b>bold</b>"],
    ["<script>window.pwned=true</script><u>kept</u>", "<u>kept</u>"],
  ])("removes executable markup from %s", (source, expected) => {
    expect(sanitiseRichTemplateHtml(source)).toBe(expected);
  });
});
