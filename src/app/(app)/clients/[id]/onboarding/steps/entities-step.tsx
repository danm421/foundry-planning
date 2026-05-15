import FamilyView from "@/components/family-view";
import type { ClientData } from "@/engine/types";
import { loadFamilyViewStepData } from "./family-view-step-data";

interface EntitiesStepProps {
  clientId: string;
  tree: ClientData;
}

export default async function EntitiesStep({ clientId, tree }: EntitiesStepProps) {
  const data = await loadFamilyViewStepData(clientId, tree);

  return (
    <FamilyView
      clientId={clientId}
      primary={data.primary}
      initialMembers={data.members}
      initialEntities={data.ents}
      initialExternalBeneficiaries={data.externals}
      initialAccounts={data.accts}
      initialDesignations={data.designations}
      initialGifts={data.giftsList}
      initialFullAccounts={[]}
      initialFullLiabilities={[]}
      initialFullIncomes={[]}
      initialFullExpenses={[]}
      initialAssetFamilyMembers={[]}
      embed="wizard"
      section="entities"
    />
  );
}
