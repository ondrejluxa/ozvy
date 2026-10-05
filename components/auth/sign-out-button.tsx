import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/lib/actions/auth";

export function SignOutButton({ label, variant = "ghost" }: { label: string; variant?: "ghost" | "outline" }) {
  return (
    <form action={signOutAction}>
      <Button type="submit" variant={variant} size="sm" className="w-full justify-start gap-2">
        <LogOut aria-hidden />
        {label}
      </Button>
    </form>
  );
}
