'use client';

import { useState, useEffect, useCallback } from 'react';
import { useUser } from '@/firebase';
import { getActiveMembershipForEntity } from '@/services/membership.service';
import { Membership } from '@/types/membership';
import { Entity } from '@/types/entity';

export function useActiveMembership(entityId: string) {
  const { user, loading: userLoading } = useUser();
  const [membership, setMembership] = useState<Membership | null>(null);
  const [entity, setEntity] = useState<Entity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (userLoading) return;
    if (!user) {
      setError("User not authenticated");
      setLoading(false);
      return;
    }

    if (!entityId) {
      setError("No entity ID provided");
      setLoading(false);
      return;
    }

    async function load() {
      setLoading(true);
      try {
        const result = await getActiveMembershipForEntity(user!.uid, entityId);
        if (!result) {
          setError("Accès refusé ou entité inactive.");
          setMembership(null);
          setEntity(null);
        } else {
          setMembership(result.membership);
          setEntity(result.entity);
          setError(null);
        }
      } catch (e: any) {
        setError(e.message || "Failed to load membership");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [user, userLoading, entityId]);

  const hasPermission = useCallback((permissionCode: string) => {
    if (!membership) return false;
    return membership.permissions.includes(permissionCode);
  }, [membership]);

  return {
    loading: loading || userLoading,
    error,
    membership,
    entity,
    permissions: membership?.permissions || [],
    hasPermission,
  };
}
