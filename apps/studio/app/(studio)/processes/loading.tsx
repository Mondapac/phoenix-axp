import { Card, PageContainer, Skeleton } from '@phoenix/ui';

// What the process screens show while the API answers: the page's outline, no text.

export default function ProcessesLoading() {
  return (
    <PageContainer>
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-7 w-56" />
      </div>
      <Card className="space-y-4 p-5">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="flex items-center gap-4">
            <Skeleton className="h-5 flex-1" />
            <Skeleton className="h-5 w-1/4" />
            <Skeleton className="h-5 w-1/6 max-sm:hidden" />
          </div>
        ))}
      </Card>
    </PageContainer>
  );
}
