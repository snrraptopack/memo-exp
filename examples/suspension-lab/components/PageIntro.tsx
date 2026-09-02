interface PageIntroProps {
  eyebrow: string;
  title: string;
  description: string;
  code: string;
}

export function PageIntro({ eyebrow, title, description, code }: PageIntroProps) {
  return (
    <header class="page-intro">
      <div>
        <p class="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p class="page-description">{description}</p>
      </div>
      <code>{code}</code>
    </header>
  );
}
