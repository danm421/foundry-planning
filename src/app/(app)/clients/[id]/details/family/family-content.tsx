import FamilyView from "@/components/family-view";
import OpenItemsPanel from "@/components/open-items/open-items-panel";
import { loadFamilyViewProps } from "./load-view-props";

interface FamilyContentProps {
  clientId: string;
  scenarioParam: string | undefined;
}

export async function FamilyContent({ clientId: id, scenarioParam }: FamilyContentProps) {
  const { props, firmId } = await loadFamilyViewProps(id, scenarioParam);

  return (
    <>
      <FamilyView {...props} />
      <OpenItemsPanel clientId={id} firmId={firmId} />
    </>
  );
}
