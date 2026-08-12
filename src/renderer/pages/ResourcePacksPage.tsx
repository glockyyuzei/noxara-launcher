import ContentPage from "./ContentPage";

export default function ResourcePacksPage() {
  return (
    <ContentPage
      category="resourcepack"
      title="Resource Packs"
      subtitle="Browse and install Modrinth resource packs into your instances."
      emptyTitle="No resource packs found"
      emptyDescription="Try another search or filter."
      singleName="Resource pack"
    />
  );
}
