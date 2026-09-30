export interface Person {
  id: string;
  name: string;
  initials: string;
  role: string;
  discipline: string;
  city: string;
  rate: number;
  available: boolean;
  skills: string[];
  bio: string;
  color: string;
  portrait: string;
  project: string;
}
export const people: Person[] = [
  {
    id: "ama",
    name: "Ama Boateng",
    initials: "AB",
    role: "Product designer",
    discipline: "Design",
    city: "Accra, Ghana",
    rate: 320,
    available: true,
    skills: ["Product design", "Research", "Prototyping"],
    bio: "I turn complicated ideas into products that feel wonderfully simple. Especially interested in tools that make everyday life a little better.",
    color: "peach",
    portrait: new URL("./assets/ama.svg", import.meta.url).href,
    project: "A calmer way to manage your money",
  },
  {
    id: "kwame",
    name: "Kwame Mensah",
    initials: "KM",
    role: "Creative developer",
    discipline: "Engineering",
    city: "Kumasi, Ghana",
    rate: 380,
    available: true,
    skills: ["Frontend", "Motion", "Accessibility"],
    bio: "A builder at the intersection of code and craft. I love fast interfaces, thoughtful details, and making the web more welcoming.",
    color: "blue",
    portrait: new URL("./assets/kwame.svg", import.meta.url).href,
    project: "An interactive archive of African art",
  },
  {
    id: "esi",
    name: "Esi Owusu",
    initials: "EO",
    role: "Brand strategist",
    discipline: "Strategy",
    city: "Cape Coast, Ghana",
    rate: 280,
    available: true,
    skills: ["Brand strategy", "Storytelling", "Community"],
    bio: "Helping good ideas find their voice. I bring a research-first approach, a sharp pencil, and a soft spot for independent businesses.",
    color: "yellow",
    portrait: new URL("./assets/esi.svg", import.meta.url).href,
    project: "A new voice for a neighborhood bakery",
  },
  {
    id: "nana",
    name: "Nana Asante",
    initials: "NA",
    role: "Visual designer",
    discipline: "Design",
    city: "Accra, Ghana",
    rate: 300,
    available: false,
    skills: ["Art direction", "Illustration", "Brand strategy"],
    bio: "Making brands that are impossible to mistake for anyone else. Color, character, and a little unexpected joy are my favorite ingredients.",
    color: "pink",
    portrait: new URL("./assets/nana.svg", import.meta.url).href,
    project: "Identity for a festival of new ideas",
  },
  {
    id: "kofi",
    name: "Kofi Adjei",
    initials: "KA",
    role: "Full-stack engineer",
    discipline: "Engineering",
    city: "Tema, Ghana",
    rate: 420,
    available: true,
    skills: ["Frontend", "Backend", "Product design"],
    bio: "From the first prototype to the production launch. I build dependable systems and help small teams ship ambitious things.",
    color: "mint",
    portrait: new URL("./assets/kofi.svg", import.meta.url).href,
    project: "A marketplace for local makers",
  },
  {
    id: "akosua",
    name: "Akosua Darko",
    initials: "AD",
    role: "Community architect",
    discipline: "Strategy",
    city: "Takoradi, Ghana",
    rate: 260,
    available: true,
    skills: ["Community", "Research", "Storytelling"],
    bio: "The best projects start with people. I design communities, run workshops, and connect the dots between an idea and the people it serves.",
    color: "lilac",
    portrait: new URL("./assets/akosua.svg", import.meta.url).href,
    project: "A learning circle for first-time founders",
  },
];
export interface Brief {
  name: string;
  description: string;
  skills: string[];
  budget: number;
}
export const briefs: Brief[] = [
  {
    name: "A marketplace for local makers",
    description:
      "Give independent makers a beautiful place to share their craft. A small team, a big local impact.",
    skills: ["Product design", "Frontend", "Brand strategy"],
    budget: 1200,
  },
  {
    name: "A learning circle for young founders",
    description:
      "Bring the next generation of builders together. Turn shared curiosity into a supportive community.",
    skills: ["Community", "Research", "Frontend"],
    budget: 1000,
  },
  {
    name: "An independent culture magazine",
    description:
      "Stories worth slowing down for. Build a digital home for fresh voices and unexpected perspectives.",
    skills: ["Art direction", "Storytelling", "Frontend"],
    budget: 1100,
  },
];
export const starterTasks = [
  {
    id: "direction",
    title: "Find our shared direction",
    note: "A short kickoff. A big idea.",
    done: false,
  },
  {
    id: "research",
    title: "Listen before we build",
    note: "Meet the people we are making this for.",
    done: false,
  },
  {
    id: "prototype",
    title: "Make the first thing real",
    note: "A small prototype with plenty of heart.",
    done: false,
  },
];
