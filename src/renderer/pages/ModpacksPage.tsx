import ContentPage from "./ContentPage";

export default function ModpacksPage() {
  return (
    <ContentPage
      category="modpack"
      title="Modpacks"
      subtitle="Browse and install Modrinth modpacks into your instances."
      needsLoader
      emptyTitle="No modpacks found"
      emptyDescription="Try another search or filter."
      singleName="Modpack"
    />
  );
}
