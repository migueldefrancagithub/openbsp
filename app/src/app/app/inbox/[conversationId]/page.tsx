import { redirect } from "next/navigation";

export default function LegacyConversationPage() {
  redirect("/app/channel-inbox");
}
