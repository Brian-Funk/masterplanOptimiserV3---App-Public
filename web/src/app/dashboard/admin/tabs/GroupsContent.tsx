"use client";

import React, { useState, useEffect } from "react";
import { Button, Spinner } from "@/components/ui";
import ResourceSelector from "@/components/ResourceSelector";
import { groupsApi, personsApi, Group, GroupMember, Person } from "@/lib/api";
import {
  getDirectPersonIdsFromMembers,
  getIncludedGroupIdsFromMembers,
  mergeGroupMemberSelections,
  normaliseGroupMembers,
  removeGroupMemberSelection,
  resolveGroupMemberList,
  resolveGroupMembers,
  wouldCreateCircularGroupReference,
} from "@/lib/groupMembers";

interface GroupsContentProps {
  selectedEvent: any;
}

export default function GroupsContent({ selectedEvent }: GroupsContentProps) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [persons, setPersons] = useState<Person[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<"view" | "edit" | "create">(
    "view",
  );
  const [selectedItem, setSelectedItem] = useState<Group | null>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null,
  );
  const [formData, setFormData] = useState<{
    name: string;
    members: GroupMember[];
  }>({
    name: "",
    members: [],
  });

  useEffect(() => {
    if (selectedEvent) {
      fetchPersons();
      fetchGroups();
    }
  }, [selectedEvent]);

  const fetchPersons = async () => {
    if (!selectedEvent) return;
    try {
      const data = await personsApi.getAll(selectedEvent.id);
      setPersons(data);
    } catch (error) {
      console.error("Failed to fetch persons:", error);
    }
  };

  const fetchGroups = async () => {
    if (!selectedEvent) return;
    setIsLoading(true);
    try {
      const data = await groupsApi.getAll(selectedEvent.id);
      setGroups(data);
    } catch (error) {
      console.error("Failed to fetch groups:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = () => {
    setModalMode("create");
    setSelectedItem(null);
    setValidationMessage(null);
    setFormData({
      name: "",
      members: [],
    });
    setShowModal(true);
  };

  const handleView = (item: Group) => {
    setModalMode("view");
    setSelectedItem(item);
    setValidationMessage(null);
    setFormData({
      name: item.name,
      members: normaliseGroupMembers(item.members || []),
    });
    setShowModal(true);
  };

  const handleEdit = (item: Group) => {
    setModalMode("edit");
    setSelectedItem(item);
    setValidationMessage(null);
    setFormData({
      name: item.name,
      members: normaliseGroupMembers(item.members || []),
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!selectedEvent) return;

    try {
      const members = normaliseGroupMembers(formData.members);
      const includedGroupIds = getIncludedGroupIdsFromMembers(members);

      if (
        selectedItem &&
        wouldCreateCircularGroupReference(
          selectedItem.id,
          includedGroupIds,
          groups,
        )
      ) {
        setValidationMessage("This would create a circular group reference.");
        return;
      }

      if (modalMode === "create") {
        await groupsApi.create(selectedEvent.id, {
          name: formData.name,
          members,
        });
      } else if (modalMode === "edit" && selectedItem) {
        await groupsApi.update(selectedEvent.id, selectedItem.id, {
          name: formData.name,
          members,
        });
      }
      await fetchGroups();
      setShowModal(false);
    } catch (error) {
      console.error("Failed to save:", error);
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Failed to save. Please try again.";
      setValidationMessage(message);
    }
  };

  const handleDelete = async () => {
    if (!selectedEvent || !selectedItem) return;

    if (!confirm("Are you sure you want to delete this group?")) {
      return;
    }

    try {
      await groupsApi.delete(selectedEvent.id, selectedItem.id);
      await fetchGroups();
      setShowModal(false);
    } catch (error) {
      console.error("Failed to delete:", error);
      alert("Failed to delete. Please try again.");
    }
  };

  const addPersonMember = (personId: number) => {
    if (getDirectPersonIdsFromMembers(formData.members).includes(personId)) {
      return;
    }
    setFormData({
      ...formData,
      members: mergeGroupMemberSelections(formData.members, [
        { type: "person", id: personId },
      ]),
    });
  };

  const addGroupMember = (groupId: number) => {
    if (selectedItem?.id === groupId) {
      setValidationMessage("This would create a circular group reference.");
      return;
    }

    const currentGroupIds = getIncludedGroupIdsFromMembers(formData.members);
    if (currentGroupIds.includes(groupId)) {
      setValidationMessage("This group is already included.");
      return;
    }

    const nextIncludedGroupIds = [...currentGroupIds, groupId];
    if (
      selectedItem &&
      wouldCreateCircularGroupReference(
        selectedItem.id,
        nextIncludedGroupIds,
        groups,
      )
    ) {
      setValidationMessage("This would create a circular group reference.");
      return;
    }

    setValidationMessage(null);
    setFormData({
      ...formData,
      members: mergeGroupMemberSelections(formData.members, [
        { type: "group", id: groupId },
      ]),
    });
  };

  const removeMember = (memberType: GroupMember["type"], memberId: number) => {
    setFormData({
      ...formData,
      members: removeGroupMemberSelection(formData.members, memberType, memberId),
    });
  };

  const getPersonDisplay = (personId: number) => {
    const person = persons.find((p) => p.id === personId);
    return person
      ? `${person.first_name} ${person.last_name}`
      : "Unknown Person";
  };

  const getGroupDisplay = (groupId: number) => {
    return groups.find((group) => group.id === groupId)?.name || "Unknown Group";
  };

  const getResolvedSummary = (
    members: GroupMember[],
    sourceGroupId?: number,
  ) => {
    const resolved =
      sourceGroupId !== undefined
        ? resolveGroupMembers(sourceGroupId, groups)
        : resolveGroupMemberList(members, groups);
    const includedGroupCount = getIncludedGroupIdsFromMembers(members).length;
    const personLabel = resolved.personIds.length === 1 ? "person" : "people";
    const groupLabel = includedGroupCount === 1 ? "group" : "groups";

    return {
      ...resolved,
      label:
        includedGroupCount > 0
          ? `Includes ${resolved.personIds.length} ${personLabel} from ${includedGroupCount} included ${groupLabel}.`
          : `Includes ${resolved.personIds.length} ${personLabel}.`,
    };
  };

  const getSelectedMemberResources = (members: GroupMember[]) =>
    normaliseGroupMembers(members).map((member) => ({
      id: member.id,
      name:
        member.type === "group"
          ? getGroupDisplay(member.id)
          : getPersonDisplay(member.id),
      type: member.type,
    }));

  if (!selectedEvent) {
    return (
      <div className="p-6">
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
          <p className="text-sm text-amber-800 dark:text-amber-300">
            Please select an event to manage groups.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-2">Groups</h3>
          <p className="text-sm text-foreground-muted">
            Create groups to organise people
          </p>
        </div>
        <Button variant="primary" onClick={handleCreate}>
          + Add Group
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : groups.length === 0 ? (
        <div className="text-center py-12 text-foreground-muted">
          <p>No groups defined yet.</p>
          <p className="text-sm mt-2">Create groups to organise people.</p>
        </div>
      ) : (
        <div className="bg-surface rounded-lg border border-bordercl">
          <table className="min-w-full divide-y divide-bordercl">
            <thead className="bg-surface-alt">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  Members
                </th>
              </tr>
            </thead>
            <tbody className="bg-surface divide-y divide-bordercl">
              {groups.map((group) => {
                const members = normaliseGroupMembers(group.members || []);
                const directPersonIds = getDirectPersonIdsFromMembers(members);
                const includedGroupIds = getIncludedGroupIdsFromMembers(members);
                const resolvedSummary = getResolvedSummary(members, group.id);

                return (
                  <tr
                    key={group.id}
                    className="hover:bg-surface-hover cursor-pointer"
                    onDoubleClick={() => handleEdit(group)}
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-foreground">
                      {group.name}
                    </td>
                    <td className="px-6 py-4 text-sm text-foreground-muted">
                      {members.length === 0 ? (
                        <span className="text-foreground-faint">None</span>
                      ) : (
                        <div className="space-y-1">
                          <div className="flex flex-wrap gap-1">
                            {directPersonIds.slice(0, 6).map((personId) => (
                              <span
                                key={`person-${personId}`}
                                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-600 text-white"
                              >
                                {getPersonDisplay(personId)}
                              </span>
                            ))}
                            {includedGroupIds.slice(0, 4).map((groupId) => (
                              <span
                                key={`group-${groupId}`}
                                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-surface-alt border border-bordercl text-foreground-secondary"
                              >
                                {getGroupDisplay(groupId)}
                              </span>
                            ))}
                            {members.length > 10 && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-foreground-faint text-white">
                                +{members.length - 10} more
                              </span>
                            )}
                          </div>
                          {includedGroupIds.length > 0 && (
                            <span className="text-xs text-foreground-faint">
                              {resolvedSummary.label}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-surface rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-foreground mb-4">
                {modalMode === "create"
                  ? "Create Group"
                  : modalMode === "edit"
                    ? "Edit Group"
                    : "View Group"}
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground-secondary mb-1">
                    Name *
                  </label>
                  {modalMode === "view" ? (
                    <p className="text-sm text-foreground">{formData.name}</p>
                  ) : (
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-bordercl-strong rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Enter name"
                    />
                  )}
                </div>

                {(() => {
                  const members = normaliseGroupMembers(formData.members);
                  const resolvedSummary = getResolvedSummary(members);

                  return (
                    <>
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="block text-sm font-medium text-foreground-secondary">
                            Members
                          </label>
                        </div>
                        {modalMode === "view" ? (
                          members.length === 0 ? (
                            <p className="text-sm text-foreground-muted">
                              No members
                            </p>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {members.map((member) => (
                                <span
                                  key={`${member.type}-${member.id}`}
                                  className={
                                    member.type === "group"
                                      ? "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-surface-alt border border-bordercl text-foreground-secondary"
                                      : "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-600 text-white"
                                  }
                                >
                                  {member.type === "group"
                                    ? getGroupDisplay(member.id)
                                    : getPersonDisplay(member.id)}
                                </span>
                              ))}
                            </div>
                          )
                        ) : (
                          <ResourceSelector
                            availableResources={persons.map((p) => ({
                              id: p.id,
                              name: `${p.first_name} ${p.last_name}`,
                            }))}
                            availableGroups={groups
                              .filter((group) => group.id !== selectedItem?.id)
                              .map((group) => ({
                                id: group.id,
                                name: group.name,
                              }))}
                            selectedResources={getSelectedMemberResources(
                              members,
                            )}
                            onAdd={(resource) => addPersonMember(resource.id)}
                            onAddGroup={(group) => addGroupMember(group.id)}
                            onRemove={(resourceId, resourceType) =>
                              removeMember(resourceType || "person", resourceId)
                            }
                            type="person"
                            allowMultiple={true}
                            allowQuantity={false}
                            supportsGroups={true}
                          />
                        )}
                      </div>

                      <div className="rounded-lg border border-bordercl bg-surface-alt px-3 py-2 text-sm text-foreground-muted">
                        {resolvedSummary.label}
                        {resolvedSummary.warnings.length > 0 && (
                          <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                            {resolvedSummary.warnings.join(" ")}
                          </div>
                        )}
                      </div>
                    </>
                  );
                })()}

                {validationMessage && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
                    {validationMessage}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 mt-6">
                {modalMode === "view" ? (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setShowModal(false)}
                    >
                      Close
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        setModalMode("edit");
                      }}
                    >
                      Edit
                    </Button>
                  </>
                ) : (
                  <>
                    {modalMode === "edit" && (
                      <Button variant="danger" size="sm" onClick={handleDelete}>
                        Delete
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setShowModal(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleSave}
                      disabled={!formData.name.trim()}
                    >
                      Save
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
