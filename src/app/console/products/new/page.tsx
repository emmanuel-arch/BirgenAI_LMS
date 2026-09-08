// A new product gets its own page, its own URL and its own back button.
//
// It used to be a dialog over the shelf. Eleven decisions deep, with cross-block
// validation and a live quote, is not a dialog — it cannot be linked to, cannot be
// left and returned to, and cannot show its own consequences beside it.
import { ProductBuilder } from "@/components/products/ProductBuilder";

export const metadata = { title: "New product" };

export default function NewProductPage() {
  return <ProductBuilder productId={null} />;
}
