import NewCustomerCheckout from "@/components/new-customer-checkout";
export default async function CheckoutPage({params}:{params:Promise<{token:string}>}){const {token}=await params;return <NewCustomerCheckout token={token}/>;}
