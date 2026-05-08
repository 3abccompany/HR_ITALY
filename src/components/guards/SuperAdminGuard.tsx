'use client';

import { AuthGuard } from './AuthGuard';
import { useUser } from '@/firebase';
import { useState, useEffect } from 'react';
import { getUserProfile } from '@/services/user.service';
import { AppUser } from '@/types/user';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

/**
 * Internal component to check for superAdmin platform role.
 */
function SuperAdminCheck({ children }: { children: React.ReactNode }) {
  const { user } = useUser();
  const [profile, setProfile] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    async function check() {
      if (!user) return;
      try {
        const p = await getUserProfile(user.uid);
        if (!p || p.platformRole !== 'superAdmin' || p.status !== 'active') {
          router.push('/no-access');
          return;
        }
        setProfile(p);
      } catch (e) {
        console.error("SuperAdmin check failed:", e);
        router.push('/no-access');
      } finally {
        setLoading(false);
      }
    }
    check();
  }, [user, router]);

  if (loading || !profile) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 bg-background">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <p className="text-muted-foreground font-medium animate-pulse">Vérification des privilèges...</p>
      </div>
    );
  }

  return <>{children}</>;
}

/**
 * SuperAdminGuard ensures the user is authenticated AND is an active superAdmin.
 */
export function SuperAdminGuard({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <SuperAdminCheck>{children}</SuperAdminCheck>
    </AuthGuard>
  );
}
