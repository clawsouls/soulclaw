import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { buildPixVerseVideoGenerationProvider } from "./video-generation-provider.js";

export default definePluginEntry({
  id: "pixverse",
  name: "PixVerse Provider",
  description: "Bundled PixVerse video provider plugin",
  register(api) {
    api.registerVideoGenerationProvider(buildPixVerseVideoGenerationProvider());
  },
});
