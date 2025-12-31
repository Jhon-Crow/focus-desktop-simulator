// Experiment to compare book and magazine thickness calculations

// Current book thickness calculation (from src/renderer.js:7674-7684)
function calculateBookThickness(totalPages) {
  const paperSheetThickness = 0.0001;
  const minPagesThickness = paperSheetThickness * 5; // 5 paper sheets minimum
  const thicknessPerPage = 0.00008; // Reduced: each page adds 0.08mm (was 0.2mm)
  const baseThickness = 0.015; // Reduced base thickness (was 0.04)
  // Min thickness based on 5 paper sheets + cover, max 0.08 for very thick books
  const calculatedThickness = Math.max(minPagesThickness + 0.01, Math.min(0.08, baseThickness + (totalPages * thicknessPerPage)));
  return calculatedThickness;
}

// Current (BUGGY) magazine thickness calculation (from src/renderer.js:8713-8717)
function calculateMagazineThicknessBuggy(totalPages) {
  // Magazines are generally thinner than books
  const pagesPerMm = 15;
  const calculatedThickness = Math.min(0.04, Math.max(0.008, totalPages / pagesPerMm / 100));
  return calculatedThickness;
}

// Proposed fixed magazine thickness calculation
function calculateMagazineThicknessFixed(totalPages) {
  // Magazines should be slightly thinner than books
  // Magazine paper is typically thinner (0.07mm vs 0.1mm for books)
  const thicknessPerPage = 0.00007; // Each page adds 0.07mm (thinner than book's 0.08mm)
  const baseThickness = 0.012; // Thinner base than book's 0.015
  const minThickness = 0.006; // Minimum thickness for very thin magazines
  const maxThickness = 0.06; // Max thickness (thinner than book's 0.08)

  const calculatedThickness = Math.max(minThickness, Math.min(maxThickness, baseThickness + (totalPages * thicknessPerPage)));
  return calculatedThickness;
}

console.log("Thickness Comparison for Different Page Counts:");
console.log("================================================");
console.log("Pages | Book      | Magazine (Buggy) | Magazine (Fixed) | Difference");
console.log("------|-----------|------------------|------------------|------------");

const pageCounts = [10, 50, 100, 150, 200, 300, 500];

for (const pages of pageCounts) {
  const bookThickness = calculateBookThickness(pages);
  const magazineBuggy = calculateMagazineThicknessBuggy(pages);
  const magazineFixed = calculateMagazineThicknessFixed(pages);
  const diff = magazineFixed - bookThickness;
  const diffPercent = ((diff / bookThickness) * 100).toFixed(1);

  console.log(
    `${pages.toString().padStart(5)} | ` +
    `${bookThickness.toFixed(5)} | ` +
    `${magazineBuggy.toFixed(5)}       | ` +
    `${magazineFixed.toFixed(5)}       | ` +
    `${diff > 0 ? '+' : ''}${diff.toFixed(5)} (${diffPercent}%)`
  );
}

console.log("\nExpected behavior: Magazine should be slightly thinner than book");
console.log("Bug: Current magazine calculation makes it much thicker for high page counts");
console.log("Fix: Use similar formula to book but with slightly lower thickness per page");
