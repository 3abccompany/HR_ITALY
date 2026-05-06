"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { loginWithEmailAndPassword, getCurrentUserContext } from "@/services/auth.service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { LogIn, Loader2 } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const userCredential = await loginWithEmailAndPassword(email, password);
      const { appUser, memberships } = await getCurrentUserContext(userCredential.user);

      if (appUser.platformRole === "superAdmin") {
        router.push("/super-admin");
        return;
      }

      if (memberships.length === 0) {
        router.push("/no-access");
      } else if (memberships.length === 1) {
        router.push(`/entity/${memberships[0].entityId}/dashboard`);
      } else {
        router.push("/select-entity");
      }
    } catch (err: any) {
      console.error(err);
      toast({
        title: "Erreur de connexion",
        description: err.message || "Vérifiez vos identifiants.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <Card className="w-full max-w-md shadow-2xl border-none">
        <CardHeader className="space-y-2 text-center pb-8">
          <div className="mx-auto bg-primary w-12 h-12 rounded-xl flex items-center justify-center mb-4">
            <LogIn className="text-white w-6 h-6" />
          </div>
          <CardTitle className="text-3xl font-headline font-bold text-primary">HR Nexus Studio</CardTitle>
          <CardDescription>Entrez vos identifiants pour accéder à la plateforme.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email">Adresse Email</Label>
              <Input 
                id="email" 
                type="email" 
                placeholder="nom@entreprise.com" 
                required 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-secondary/30"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Mot de passe</Label>
                <button type="button" className="text-xs text-accent hover:underline">Oublié ?</button>
              </div>
              <Input 
                id="password" 
                type="password" 
                required 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-secondary/30"
              />
            </div>
            <Button type="submit" className="w-full h-12 text-md font-semibold" disabled={loading}>
              {loading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : "Connexion"}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex flex-col space-y-4">
          <div className="relative w-full">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-muted" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-muted-foreground">Besoin d'aide ?</span>
            </div>
          </div>
          <p className="text-center text-xs text-muted-foreground">
            Contactez le support technique au +33 1 00 00 00 00
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}