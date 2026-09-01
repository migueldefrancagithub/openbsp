import { redirect } from "next/navigation";

export default function LegacyInboxPage() {
  redirect("/app/channel-inbox");
}
