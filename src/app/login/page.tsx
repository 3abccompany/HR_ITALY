
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { LogIn, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { useFirebase } from "@/firebase";
import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);
  
  const { auth, db } = useFirebase();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setLoading(true);

    if (!auth || !db) {
      setError("Le service Firebase n'est pas configuré. Veuillez vérifier vos variables d'environnement (NEXT_PUBLIC_FIREBASE_*).");
      setLoading(false);
      return;
    }

    try {
      // 1. Authenticate with Firebase Auth
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const uid = userCredential.user.uid;

      // 2. Fetch user profile from Firestore
      const userDocRef = doc(db, "users", uid);
      const userDoc = await getDoc(userDocRef);
      
      if (!userDoc.exists()) {
        setError("Profil utilisateur non trouvé dans la base de données.");
        // We might want to sign out here if the profile is missing
      } else {
        const userData = userDoc.data();
        
        // 3. Verify user status
        if (userData.status !== "active") {
          setError("Ce compte utilisateur est désactivé.");
        } else {
          setSuccess(true);
          console.log("Connexion réussie pour:", userData.email);
          // Redirection logic will be implemented in the next step
        }
      }
    } catch (err: any) {
      console.error("Erreur de connexion:", err);
      let message = "Une erreur est survenue lors de la connexion.";
      
      if (err.code === "auth/invalid-credential") {
        message = "Identifiants invalides. Veuillez vérifier votre email et votre mot de passe.";
      } else if (err.code === "auth/user-not-found") {
        message = "Utilisateur non trouvé.";
      } else if (err.code === "auth/wrong-password") {
        message = "Mot de passe incorrect.";
      } else if (err.code === "auth/too-many-requests") {
        message = "Trop de tentatives infructueuses. Veuillez réessayer plus tard.";
      }
      
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
            {success && (
              <Alert className="border-green-500 text-green-600 bg-green-50">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertTitle>Succès</AlertTitle>
                <AlertDescription>Connexion réussie. Redirection en cours...</AlertDescription>
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
                disabled={loading || success}
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
                disabled={loading || success}
              />
            </div>
            <Button type="submit" className="w-full h-12 text-md font-semibold" disabled={loading || success}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {loading ? "Chargement..." : "Se connecter"}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex flex-col space-y-4">
          <p className="text-center text-xs text-muted-foreground">
            HR Nexus Studio - Gestion Multi-entités
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
