"use client";

import { useTransition } from "react";
import { switchUser } from "@/app/actions";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DirectoryUser } from "@/domain/directory";

function label(user: DirectoryUser) {
  if (user.role === "pm") return `${user.name} · PM`;
  return user.account ? `${user.name} · ${user.account.name}` : user.name;
}

export function UserSwitcher({
  users,
  currentId,
}: {
  users: DirectoryUser[];
  currentId: number;
}) {
  const [pending, startTransition] = useTransition();
  const items = users.map((u) => ({ value: String(u.id), label: label(u) }));
  const groups = [
    { label: "Submitters", users: users.filter((u) => u.role === "submitter") },
    { label: "Product managers", users: users.filter((u) => u.role === "pm") },
  ];

  return (
    <Select
      items={items}
      value={String(currentId)}
      onValueChange={(value) => {
        if (value) startTransition(() => switchUser(Number(value)));
      }}
      disabled={pending}
    >
      <SelectTrigger aria-label="Acting as" className="w-72">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {groups.map((group) => (
          <SelectGroup key={group.label}>
            <SelectLabel>{group.label}</SelectLabel>
            {group.users.map((u) => (
              <SelectItem key={u.id} value={String(u.id)}>
                {label(u)}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
