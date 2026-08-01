# Workflows

## Planning A Schedule

1. Create or select an event in the project hub.
2. Configure the event date range and day aliases.
3. Define global building blocks: locations, capabilities, capability types, task types, and task templates.
4. Add people and assign capabilities.
5. Create task instances in the task builder or CMI calendar input.
6. Run flow checks and optimisation.
7. Review the optimised schedule and adjust task assignments or timings where needed.
8. Finalise and publish.

## Capabilities

Capabilities represent skills or roles that tasks require and people can fulfil. They are sorted by capability type and then by machine name so internal names stay predictable even when display names change.

Event capability settings can restrict which global capabilities are active for a specific event. Event-scoped task and person screens should use the filtered event capability list.

## Optimisation

The optimiser assigns people to tasks while respecting availability, capability requirements, locations, transfers, timing, and fatigue-related constraints. The frontend starts an optimisation job through the backend; the backend normalises data and delegates the solving work to compute modules.

After optimisation, task instances keep both optimised state and final state. The final state is what the user edits and what publishing uses.

## Metrics And Presentation

The metrics board is a separate view for inspecting workload, allocation, and schedule quality. Presentation mode opens a dedicated schedule display window and follows the selected day from the Optimised tab when opened or synced.

Keyboard shortcuts are configurable under Settings, and shortcut conflicts are highlighted without blocking save.

## Publishing

Publishing can target:

- no target;
- Google Calendar;
- MP-Backend;
- both Google Calendar and MP-Backend.

The default publish target is `none`, which prevents a clean install from trying to publish before the user configures an integration.

Before publishing, the app finalises current task instance state so the backend task table reflects the reviewed schedule. Google Calendar publishing can target one selected day or all days. MP-Backend publishing sends the finalised event data to the configured receiver.

## Import And Export

The data management tools support event and full data exports. Publish secrets and integration identifiers should not leak through exported data. Imports are intended for controlled backup, migration, or setup reuse.

Portable backups preserve the event and person accountability identities used by deletion workflows. Restore them into an empty database or remove the existing source project first. If either identity already exists locally, the import stops before writing application settings or project data and reports the conflict rather than creating a second record with the same identity.
