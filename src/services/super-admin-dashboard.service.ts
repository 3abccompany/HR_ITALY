import {
  collection,
  onSnapshot,
  type DocumentData,
  type QuerySnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { Entity } from "@/types/entity";
import type { Membership } from "@/types/membership";
import type { Permission } from "@/types/permission";
import type { Role } from "@/types/role";
import type { AppUser } from "@/types/user";
import { buildSuperAdminHealthReport } from "./super-admin-health.service";
import type {
  SuperAdminDashboardSummary,
  SuperAdminStatusSummary,
} from "@/types/super-admin-dashboard";

function createStatusSummary<T extends { status?: string }>(items: T[]): SuperAdminStatusSummary {
  return {
    total: items.length,
    active: items.filter((item) => item.status === "active").length,
    inactive: items.filter((item) => !!item.status && item.status !== "active").length,
  };
}

function resolveUserIdentifier(value: Pick<Membership, "uid" | "userId"> | Partial<Membership>): string | null {
  const identifier = value.uid || value.userId;
  return typeof identifier === "string" && identifier.trim().length > 0 ? identifier.trim() : null;
}

function resolveEntityIdentifier(value: Partial<Membership>): string | null {
  const identifier = value.entityId;
  return typeof identifier === "string" && identifier.trim().length > 0 ? identifier.trim() : null;
}

function resolveUserUid(value: Partial<AppUser>, documentId: string): string | null {
  const identifier = value.uid || documentId;
  return typeof identifier === "string" && identifier.trim().length > 0 ? identifier.trim() : null;
}

function resolveEntityId(value: Partial<Entity>, documentId: string): string | null {
  const identifier = value.entityId || documentId;
  return typeof identifier === "string" && identifier.trim().length > 0 ? identifier.trim() : null;
}

function snapshotToData<T>(snapshot: QuerySnapshot<DocumentData>): (T & { id?: string })[] {
  return snapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  })) as (T & { id?: string })[];
}

function buildSuperAdminDashboardSummary(params: {
  entities: (Entity & { id?: string })[];
  users: (AppUser & { id?: string })[];
  memberships: (Membership & { id?: string })[];
  roles: Role[];
  permissions: Permission[];
}): SuperAdminDashboardSummary {
  const { entities, users, memberships, roles, permissions } = params;
  const userIds = new Set(
    users
      .map((user) => resolveUserUid(user, user.id || ""))
      .filter((uid): uid is string => !!uid)
  );
  const entityIds = new Set(
    entities
      .map((entity) => resolveEntityId(entity, entity.id || ""))
      .filter((entityId): entityId is string => !!entityId)
  );
  const membershipUserIds = new Set(
    memberships
      .map(resolveUserIdentifier)
      .filter((uid): uid is string => !!uid)
  );

  const usersWithoutMembership = users.filter((user) => {
    const uid = resolveUserUid(user, user.id || "");
    return !!uid && !membershipUserIds.has(uid);
  }).length;

  const brokenMemberships = memberships.filter((membership) => {
    const membershipUserId = resolveUserIdentifier(membership);
    const membershipEntityId = resolveEntityIdentifier(membership);

    return (
      !membershipUserId ||
      !membershipEntityId ||
      !userIds.has(membershipUserId) ||
      !entityIds.has(membershipEntityId)
    );
  }).length;

  return {
    entities: createStatusSummary(entities),
    users: createStatusSummary(users),
    memberships: createStatusSummary(memberships),
    accessHealth: {
      usersWithoutMembership,
      brokenMemberships,
    },
    health: buildSuperAdminHealthReport({ entities, users, memberships, roles, permissions }).summary,
    catalog: {
      roles: roles.length,
      permissions: permissions.length,
    },
    isEmptyPlatform:
      entities.length === 0 &&
      users.length === 0 &&
      memberships.length === 0 &&
      roles.length === 0 &&
      permissions.length === 0,
  };
}

export function subscribeSuperAdminDashboardSummary(
  onUpdate: (summary: SuperAdminDashboardSummary) => void,
  onError: (error: Error) => void
): Unsubscribe {
  if (!db) {
    onError(new Error("Firestore n'est pas initialisé."));
    return () => {};
  }

  const latest: {
    entities?: (Entity & { id?: string })[];
    users?: (AppUser & { id?: string })[];
    memberships?: (Membership & { id?: string })[];
    roles?: Role[];
    permissions?: Permission[];
  } = {};
  const loadedCollections = new Set<string>();
  const unsubscribers: Unsubscribe[] = [];

  const cleanup = () => {
    while (unsubscribers.length > 0) {
      const unsubscribe = unsubscribers.pop();
      unsubscribe?.();
    }
  };

  const emitIfReady = () => {
    if (loadedCollections.size !== 5) return;

    onUpdate(
      buildSuperAdminDashboardSummary({
        entities: latest.entities || [],
        users: latest.users || [],
        memberships: latest.memberships || [],
        roles: latest.roles || [],
        permissions: latest.permissions || [],
      })
    );
  };

  const handleError = (error: unknown) => {
    console.error("[SuperAdminDashboard] Realtime platform indicators failed", error);
    cleanup();
    onError(new Error("Impossible de synchroniser les indicateurs plateforme."));
  };

  unsubscribers.push(
    onSnapshot(
      collection(db, "entities"),
      (snapshot) => {
        latest.entities = snapshotToData<Entity>(snapshot);
        loadedCollections.add("entities");
        emitIfReady();
      },
      handleError
    ),
    onSnapshot(
      collection(db, "users"),
      (snapshot) => {
        latest.users = snapshotToData<AppUser>(snapshot);
        loadedCollections.add("users");
        emitIfReady();
      },
      handleError
    ),
    onSnapshot(
      collection(db, "memberships"),
      (snapshot) => {
        latest.memberships = snapshotToData<Membership>(snapshot);
        loadedCollections.add("memberships");
        emitIfReady();
      },
      handleError
    ),
    onSnapshot(
      collection(db, "roles"),
      (snapshot) => {
        latest.roles = snapshotToData<Role>(snapshot);
        loadedCollections.add("roles");
        emitIfReady();
      },
      handleError
    ),
    onSnapshot(
      collection(db, "permissions"),
      (snapshot) => {
        latest.permissions = snapshotToData<Permission>(snapshot);
        loadedCollections.add("permissions");
        emitIfReady();
      },
      handleError
    )
  );

  return cleanup;
}
