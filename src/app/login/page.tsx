
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { LogIn } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    console.log("Login attempt with:", email);
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
              <Label htmlFor="password">Mot de passe</Label>
              <Input 
                id="password" 
                type="password" 
                required 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-secondary/30"
              />
            </div>
            <Button type="submit" className="w-full h-12 text-md font-semibold">
              Connexion
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
