
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { LogIn, Loader2, AlertCircle } from "lucide-react";
import { useFirebase } from "@/firebase";
import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const router = useRouter();
  const { auth, db } = useFirebase();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (!auth || !db) {
      setError("Le service Firebase n'est pas configuré. Veuillez vérifier vos variables d'environnement.");
      setLoading(false);
      return;
    }

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const uid = userCredential.user.uid;

      // Check if user profile exists in Firestore
      const userDoc = await getDoc(doc(db, "users", uid));
      
      if (!userDoc.exists()) {
        setError("Profil utilisateur non trouvé dans la base de données.");
      } else {
        const userData = userDoc.data();
        console.log("User profile found:", userData);
        router.push("/select-entity"); 
      }
    } catch (err: any) {
      console.error("Login error:", err);
      let message = "Erreur de connexion. Veuillez vérifier vos identifiants.";
      if (err.code === "auth/invalid-credential") message = "Identifiants invalides.";
      if (err.code === "auth/user-not-found") message = "Utilisateur non trouvé.";
      setError(message);
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
          <CardTitle className="text-3xl font-headline font-bold text-primary">Connexion</CardTitle>
          <CardDescription>Entrez vos identifiants pour accéder à HR Nexus.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-6">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Erreur</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
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
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Mot de passe</Label>
              <Input 
                id="password" 
                type="password" 
                required 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-secondary/30"
                disabled={loading}
              />
            </div>
            <Button type="submit" className="w-full h-12 text-md font-semibold" disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {loading ? "Chargement..." : "Connexion"}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex flex-col space-y-4">
          <p className="text-center text-xs text-muted-foreground">
            Contactez le support technique au +33 1 00 00 00 00
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
