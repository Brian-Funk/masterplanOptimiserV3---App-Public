"""Validation for the small rich-text format used by Desktop templates."""

from html.parser import HTMLParser
from urllib.parse import urlsplit


ALLOWED_RICH_TEMPLATE_TAGS = {"a", "b", "br", "em", "i", "strong", "u"}
ALLOWED_RICH_TEMPLATE_SCHEMES = {"http", "https", "mailto", "tel"}
MAX_RICH_TEMPLATE_LENGTH = 50_000


class _RichTemplateValidator(HTMLParser):
    """Reject markup outside the deliberately small Desktop template format."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self._open_tags: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag not in ALLOWED_RICH_TEMPLATE_TAGS:
            raise ValueError(f"HTML tag <{tag}> is not allowed")
        if tag == "br":
            if attrs:
                raise ValueError("The <br> tag cannot have attributes")
            return

        if tag == "a":
            if len(attrs) != 1 or attrs[0][0].lower() != "href" or attrs[0][1] is None:
                raise ValueError("Links must contain exactly one href attribute")
            _validate_link(attrs[0][1])
        elif attrs:
            raise ValueError(f"HTML tag <{tag}> cannot have attributes")
        self._open_tags.append(tag)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "br" or attrs:
            raise ValueError("Only <br> may use self-closing syntax")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "br" or tag not in ALLOWED_RICH_TEMPLATE_TAGS:
            raise ValueError(f"Closing tag </{tag}> is not allowed")
        if not self._open_tags or self._open_tags.pop() != tag:
            raise ValueError("Rich-text tags must be correctly nested")

    def handle_comment(self, _data: str) -> None:
        raise ValueError("HTML comments are not allowed")

    def handle_decl(self, _decl: str) -> None:
        raise ValueError("HTML declarations are not allowed")

    def unknown_decl(self, _data: str) -> None:
        raise ValueError("HTML declarations are not allowed")

    def close(self) -> None:
        super().close()
        if self._open_tags:
            raise ValueError("Rich-text tags must be closed")


def _validate_link(value: str) -> None:
    if not value or any(ord(character) < 32 for character in value):
        raise ValueError("Link destination is invalid")
    if value.startswith("//"):
        raise ValueError("Protocol-relative links are not allowed")
    parsed = urlsplit(value)
    if parsed.scheme:
        if parsed.scheme.lower() not in ALLOWED_RICH_TEMPLATE_SCHEMES:
            raise ValueError("Link protocol is not allowed")
        return
    if not (value.startswith("/") or value.startswith("#")):
        raise ValueError("Links must use HTTPS, HTTP, mailto, tel, an absolute path, or a fragment")


def validate_rich_template(value: str | None) -> str | None:
    """Return *value* unchanged after validating its bounded rich-text grammar."""

    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("Rich-text template must be a string")
    if len(value) > MAX_RICH_TEMPLATE_LENGTH:
        raise ValueError("Rich-text template is too long")
    if "\x00" in value:
        raise ValueError("Rich-text template contains an invalid character")

    parser = _RichTemplateValidator()
    parser.feed(value)
    parser.close()
    return value
