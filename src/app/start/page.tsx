import { redirect } from "next/navigation";

// Die Modul-Kachelübersicht entfällt – Navigation erfolgt über das linke Menü.
export default function StartPage() {
  redirect("/dashboard");
}
