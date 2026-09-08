// Editing a product is the SAME builder that created it, pre-filled from the live
// version. One code path, so an edited product can never drift from a created one —
// and the wizard's steps are the only place a product's terms are ever authored.
import { ProductBuilder } from "@/components/products/ProductBuilder";

export const metadata = { title: "Edit product" };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductBuilder productId={id} />;
}
