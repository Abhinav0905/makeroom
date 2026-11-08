import CustomerOffer from "@/components/customer-offer";
export default async function OfferPage({params}:{params:Promise<{token:string}>}){const {token}=await params;return <CustomerOffer token={token}/>;}

