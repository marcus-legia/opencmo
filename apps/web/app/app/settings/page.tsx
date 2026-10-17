import { SettingsView } from "@/components/clipping/web/SettingsView";
import { mcpEndpoint } from "@/lib/cmo/connect";

export default function SettingsPage() {
  return <SettingsView mcpEndpoint={mcpEndpoint()} />;
}
