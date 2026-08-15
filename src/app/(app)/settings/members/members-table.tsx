"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { OrgRole } from "@/generated/prisma/enums";
import { ORG_ROLE_LABELS } from "@/lib/domain/labels";
import { toggleMemberActiveAction } from "@/server/actions/members";
import type { MemberListItem } from "@/server/services/members";

import { MemberRowForm } from "./member-row-form";

interface MembersTableProps {
  members: MemberListItem[];
  assignableRoles: OrgRole[];
  canManage: boolean;
}

export function MembersTable({
  members,
  assignableRoles,
  canManage,
}: MembersTableProps) {
  const [editingId, setEditingId] = useState<string | null>(null);

  if (members.length === 0) {
    return (
      <p className="px-3 py-8 text-center text-sm text-muted-foreground">
        No members yet.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Member</TableHead>
          <TableHead>Access role</TableHead>
          <TableHead>Job title</TableHead>
          <TableHead className="text-right">Capacity</TableHead>
          <TableHead>Status</TableHead>
          {canManage ? (
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          ) : null}
        </TableRow>
      </TableHeader>

      <TableBody>
        {members.map((member) => {
          const editing = editingId === member.id;

          return (
            <TableRow key={member.id}>
              {editing ? (
                <TableCell colSpan={canManage ? 6 : 5} className="bg-muted/30">
                  <MemberRowForm
                    member={member}
                    assignableRoles={assignableRoles}
                    onDone={() => setEditingId(null)}
                  />
                </TableCell>
              ) : (
                <>
                  <TableCell>
                    <div className="font-medium">
                      {member.name}
                      {member.isSelf ? (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                          (you)
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {member.email}
                    </div>
                  </TableCell>

                  <TableCell>
                    <Badge
                      variant={
                        member.role === "OWNER" || member.role === "ADMIN"
                          ? "primary"
                          : "neutral"
                      }
                    >
                      {ORG_ROLE_LABELS[member.role]}
                    </Badge>
                  </TableCell>

                  <TableCell className="text-muted-foreground">
                    {member.jobTitle ?? "—"}
                  </TableCell>

                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {member.capacity ?? "—"}
                  </TableCell>

                  <TableCell>
                    <Badge variant={member.isActive ? "success" : "neutral"}>
                      {member.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>

                  {canManage ? (
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {member.canManage ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingId(member.id)}
                            >
                              Edit
                            </Button>
                            {/* Self-deactivation is refused server-side; the
                                button is hidden here to match. */}
                            {member.isSelf ? null : (
                              <form action={toggleMemberActiveAction}>
                                <input
                                  type="hidden"
                                  name="memberId"
                                  value={member.id}
                                />
                                <input
                                  type="hidden"
                                  name="isActive"
                                  value={member.isActive ? "false" : "true"}
                                />
                                <Button
                                  type="submit"
                                  variant="ghost"
                                  size="sm"
                                  className={
                                    member.isActive ? "text-danger" : undefined
                                  }
                                >
                                  {member.isActive
                                    ? "Deactivate"
                                    : "Reactivate"}
                                </Button>
                              </form>
                            )}
                          </>
                        ) : (
                          <span className="px-2 text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </div>
                    </TableCell>
                  ) : null}
                </>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
