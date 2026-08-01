import type {
  AudienceTeam,
  Location,
  Person,
  ScheduleView,
  SessionElement,
  SessionElementType,
} from "@/lib/api";

export const SESSION_ELEMENT_COLOUR_OPTIONS = [
  { label: "Tomato", value: "#fca5a5" },
  { label: "Flamingo", value: "#fecaca" },
  { label: "Tangerine", value: "#fdba74" },
  { label: "Banana", value: "#fde68a" },
  { label: "Sage", value: "#86efac" },
  { label: "Basil", value: "#6ee7b7" },
  { label: "Peacock", value: "#7dd3fc" },
  { label: "Blueberry", value: "#a5b4fc" },
  { label: "Lavender", value: "#c4b5fd" },
  { label: "Grape", value: "#d8b4fe" },
  { label: "Graphite", value: "#cbd5e1" },
] as const;

export const DEFAULT_SESSION_ELEMENT_COLOUR = "#7dd3fc";
export const DEFAULT_SESSION_ELEMENT_COPY_TEMPLATE =
  "<b>{start_time}-{end_time}</b> {title}<br>{location} - {audience_teams}";

export const GENERAL_SCHEDULE_VARIABLES = [
  { name: "date", label: "Date" },
  { name: "day_name", label: "Day name" },
  { name: "start_time", label: "Starting time" },
  { name: "end_time", label: "End time" },
  { name: "title", label: "Title" },
  { name: "location", label: "Location" },
  { name: "audience_teams", label: "Audience teams" },
  { name: "responsible", label: "Responsible" },
  { name: "description", label: "Description" },
  { name: "type_name", label: "Session Element type" },
] as const;

export function getSessionElementColour(colour: string | null | undefined): string {
  return SESSION_ELEMENT_COLOUR_OPTIONS.some((option) => option.value === colour)
    ? colour!
    : DEFAULT_SESSION_ELEMENT_COLOUR;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizeHref(href: string): string {
  const trimmed = href.trim();
  return /^(https?:|mailto:|tel:)/i.test(trimmed) ? trimmed : "#";
}

export function sanitizeGeneralScheduleHtml(html: string): string {
  if (typeof document === "undefined") {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/\son\w+="[^"]*"/gi, "")
      .replace(/<(?!\/?(b|strong|i|em|u|br|a)(\s|>|\/))/gi, "&lt;");
  }
  const container = document.createElement("div");
  container.innerHTML = html;
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent || "");
    if (!(node instanceof HTMLElement)) return "";
    const tag = node.tagName.toLowerCase();
    const children = Array.from(node.childNodes).map(walk).join("");
    if (tag === "b" || tag === "strong") return `<b>${children}</b>`;
    if (tag === "i" || tag === "em") return `<i>${children}</i>`;
    if (tag === "u") return `<u>${children}</u>`;
    if (tag === "br") return "<br>";
    if (tag === "a") {
      return `<a href="${escapeHtml(sanitizeHref(node.getAttribute("href") || ""))}" target="_blank" rel="noreferrer">${children}</a>`;
    }
    if (tag === "div" || tag === "p") return `${children}<br>`;
    return children;
  };
  return Array.from(container.childNodes).map(walk).join("");
}

export function getSessionElementType(
  element: SessionElement,
  types: SessionElementType[],
): SessionElementType | null {
  return element.session_element_type_id
    ? types.find((candidate) => candidate.id === element.session_element_type_id) || null
    : null;
}

export function buildSessionElementVariableValues(
  element: SessionElement,
  teams: AudienceTeam[],
  locations: Location[],
  persons: Person[],
  types: SessionElementType[],
): Record<string, string> {
  const type = getSessionElementType(element, types);
  return {
    date: element.date,
    day_name: element.date,
    start_time: element.start_time,
    end_time: element.end_time,
    title: element.title,
    location: getSessionElementLocation(element, locations),
    audience_teams: getSessionElementTeamNames(element, teams).join(", "),
    responsible: getSessionElementResponsible(element, persons),
    description: element.description || "",
    type_name: type?.name || "General",
  };
}

export function renderSessionElementTemplateHtml(
  element: SessionElement,
  teams: AudienceTeam[],
  locations: Location[],
  persons: Person[],
  types: SessionElementType[],
): string {
  const type = getSessionElementType(element, types);
  const template = type?.copy_template_html || DEFAULT_SESSION_ELEMENT_COPY_TEMPLATE;
  const values = buildSessionElementVariableValues(element, teams, locations, persons, types);
  const rendered = template.replace(/\{([^}]+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(values, name)
      ? escapeHtml(values[name] ?? "")
      : match,
  );
  return sanitizeGeneralScheduleHtml(rendered);
}

export function renderSessionElementTemplateText(
  element: SessionElement,
  teams: AudienceTeam[],
  locations: Location[],
  persons: Person[],
  types: SessionElementType[],
): string {
  return stripHtml(
    renderSessionElementTemplateHtml(element, teams, locations, persons, types),
  );
}

export function renderSessionElementsTemplateHtml(
  elements: SessionElement[],
  teams: AudienceTeam[],
  locations: Location[],
  persons: Person[],
  types: SessionElementType[],
): string {
  return sanitizeGeneralScheduleHtml(
    elements
      .map(
        (element) =>
          `<div>${renderSessionElementTemplateHtml(
            element,
            teams,
            locations,
            persons,
            types,
          )}</div>`,
      )
      .join(""),
  );
}

export function renderSessionElementsTemplateText(
  elements: SessionElement[],
  teams: AudienceTeam[],
  locations: Location[],
  persons: Person[],
  types: SessionElementType[],
): string {
  return elements
    .map((element) =>
      renderSessionElementTemplateText(element, teams, locations, persons, types),
    )
    .join("\n");
}

export function sortSessionElements(elements: SessionElement[]): SessionElement[] {
  return [...elements].sort((a, b) => {
    const date = a.date.localeCompare(b.date);
    if (date !== 0) return date;
    const start = a.start_time.localeCompare(b.start_time);
    if (start !== 0) return start;
    const order = (a.sort_order ?? 0) - (b.sort_order ?? 0);
    if (order !== 0) return order;
    return a.title.localeCompare(b.title);
  });
}

export function getSessionElementLocation(
  element: SessionElement,
  locations: Location[],
): string {
  const location = element.location_id
    ? locations.find((candidate) => candidate.id === element.location_id)
    : null;
  return location?.name || "No location";
}

export function getSessionElementResponsible(
  element: SessionElement,
  persons: Person[],
): string {
  const person = element.responsible_person_id
    ? persons.find((candidate) => candidate.id === element.responsible_person_id)
    : null;
  if (person) return `${person.first_name} ${person.last_name}`.trim();
  return element.responsible_text?.trim() || "";
}

export function getSessionElementTeamNames(
  element: SessionElement,
  teams: AudienceTeam[],
): string[] {
  return (element.attendee_team_ids || []).map((teamId) => {
    const team = teams.find((candidate) => candidate.id === teamId);
    return team?.short_name || team?.name || `Missing team ${teamId}`;
  });
}

/** Return true when a Session Element is eligible for public publication. */
export function isPublicSessionElementPublished(element: SessionElement): boolean {
  return (
    element.visibility === "public" &&
    Array.isArray(element.schedule_view_ids) &&
    element.schedule_view_ids.length > 0
  );
}

/** Serialise the public fields that determine General Schedule publish confidence. */
export function buildGeneralSchedulePublicFingerprintSource(
  elements: SessionElement[],
  teams: AudienceTeam[],
  locations: Location[],
  persons: Person[] = [],
  types: SessionElementType[] = [],
  scheduleViews: ScheduleView[] = [],
): string {
  const scheduleViewById = new Map(scheduleViews.map((view) => [view.id, view]));
  const payload = elements
    .filter(isPublicSessionElementPublished)
    .map((element) => {
      const location = element.location_id
        ? locations.find((candidate) => candidate.id === element.location_id)
        : null;
      return {
        id: element.id,
        title: element.title,
        type_id: element.session_element_type_id ?? null,
        date: element.date,
        start_time: element.start_time,
        end_time: element.end_time,
        location_name: location?.name?.trim() || null,
        location_address: location?.address?.trim() || null,
        audience_teams: (element.attendee_team_ids || [])
          .map((teamId) => teams.find((candidate) => candidate.id === teamId))
          .filter((team): team is AudienceTeam => Boolean(team))
          .map((team) => ({
            id: team.id,
            name: team.name,
            short_name: team.short_name ?? null,
            colour: team.colour ?? null,
          })),
        schedule_views: (element.schedule_view_ids || [])
          .map((viewId) => scheduleViewById.get(viewId))
          .filter((view): view is ScheduleView => Boolean(view))
          .map((view) => ({
            id: view.id,
            name: view.name,
            sort_order: view.sort_order ?? 0,
          })),
        responsible: getSessionElementResponsible(element, persons) || null,
        description: element.description || null,
        colour: getSessionElementColour(getSessionElementType(element, types)?.colour),
        copy_template_html:
          getSessionElementType(element, types)?.copy_template_html || null,
        sort_order: element.sort_order || 0,
      };
    })
    .sort((left, right) => left.id - right.id);
  return JSON.stringify(payload);
}

/** Hash the current public General Schedule fields for publish comparison. */
export async function buildGeneralSchedulePublicFingerprint(
  elements: SessionElement[],
  teams: AudienceTeam[],
  locations: Location[],
  persons: Person[] = [],
  types: SessionElementType[] = [],
  scheduleViews: ScheduleView[] = [],
): Promise<string> {
  const source = buildGeneralSchedulePublicFingerprintSource(
    elements,
    teams,
    locations,
    persons,
    types,
    scheduleViews,
  );
  if (typeof crypto === "undefined" || !crypto.subtle) return source;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(source),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function exportGeneralScheduleText(
  elements: SessionElement[],
  teams: AudienceTeam[],
  locations: Location[],
  persons: Person[] = [],
  types: SessionElementType[] = [],
  includeInternal = false,
): string {
  return renderSessionElementsTemplateText(
    sortSessionElements(
    elements.filter(
      (element) => includeInternal || element.visibility === "public",
    ),
    ),
    teams,
    locations,
    persons,
    types,
  );
}

export function exportGeneralScheduleMarkdown(
  elements: SessionElement[],
  teams: AudienceTeam[],
  locations: Location[],
  persons: Person[] = [],
  types: SessionElementType[] = [],
  includeInternal = false,
): string {
  const rows = sortSessionElements(
    elements.filter(
      (element) => includeInternal || element.visibility === "public",
    ),
  ).map((element) => {
    const values = buildSessionElementVariableValues(element, teams, locations, persons, types);
    return `| ${values.date} | ${values.start_time}-${values.end_time} | ${values.title} | ${values.location} | ${values.audience_teams} | ${values.responsible || ""} |`;
  });
  return [
    "| Date | Time | Title | Location | Audience | Responsible |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}
