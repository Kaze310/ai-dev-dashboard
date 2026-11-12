import { redirect } from "next/navigation";

// Keep Cognito's already-registered sign-out landing URL working.
export default function CognitoPage() { redirect("/login"); }
