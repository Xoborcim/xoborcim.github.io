export const ROLES = ['TOP','JUNGLE','MIDDLE','BOTTOM','UTILITY'];
export const ROLE_NAMES = {TOP:'Top',JUNGLE:'Jungle',MIDDLE:'Mid',BOTTOM:'Bot',UTILITY:'Support'};
// Role hints support the offline selector only; observed match positions determine recommendations.
const groups = {
 TOP:'Aatrox Akali Ambessa Camille Chogath Darius DrMundo Fiora Gangplank Garen Gnar Gragas Gwen Heimerdinger Illaoi Irelia Jax Jayce Kayle Kennen Kled KSante Malphite Mordekaiser Nasus Olaf Ornn Pantheon Poppy Quinn Renekton Rengar Riven Rumble Ryze Sett Shen Singed Sion TahmKench Teemo Trundle Tryndamere Udyr Urgot Vayne Vladimir Volibear Warwick Wukong Yasuo Yone Yorick',
 JUNGLE:'Amumu Belveth Brand Briar Diana DrMundo Ekko Elise Evelynn Fiddlesticks Graves Gwen Hecarim Ivern JarvanIV Jax Karthus Kayn Khazix Kindred LeeSin Lillia MasterYi Morgana Naafiri Nautilus Nidalee Nocturne Nunu Olaf Pantheon Poppy Qiyana Rammus RekSai Rell Rengar Sejuani Shaco Shyvana Skarner Sylas Talon Taliyah Trundle Udyr Vi Viego Volibear Warwick Wukong XinZhao Zac Zed Zyra',
 MIDDLE:'Ahri Akali Akshan Anivia Annie AurelionSol Aurora Azir Brand Cassiopeia Chogath Corki Diana Ekko Fizz Galio Gragas Hwei Irelia Jayce Karma Kassadin Katarina Kayle Kennen KogMaw Leblanc Lissandra Lucian Lux Malphite Malzahar Mel Morgana Naafiri Neeko Orianna Pantheon Qiyana Rumble Ryze Seraphine Smolder Swain Sylas Syndra Taliyah Talon Tristana TwistedFate Veigar Velkoz Vex Viktor Vladimir Xerath Yasuo Yone Zed Ziggs Zoe',
 BOTTOM:'Aphelios Ashe Caitlyn Corki Draven Ezreal Jhin Jinx Kaisa Kalista Karthus KogMaw Lucian MissFortune Nilah Samira Senna Seraphine Sivir Smolder Swain Tristana Twitch Varus Vayne Veigar Xayah Yasuo Zeri Ziggs',
 UTILITY:'Alistar Amumu Ashe Bard Blitzcrank Brand Braum Camille Fiddlesticks Galio Heimerdinger Hwei Janna Karma Leona Lissandra Lulu Lux Maokai Milio Morgana Nami Nautilus Neeko Pantheon Poppy Pyke Rakan Rell Renata Renekton Senna Seraphine Sett Shaco Shen Sona Soraka Swain TahmKench Taric Thresh Twitch Velkoz Xerath Yuumi Zac Zilean Zyra'
};
const names = {AurelionSol:'Aurelion Sol',Belveth:"Bel’Veth",Chogath:"Cho’Gath",DrMundo:'Dr. Mundo',JarvanIV:'Jarvan IV',KSante:"K’Sante",Kaisa:"Kai’Sa",Khazix:"Kha’Zix",KogMaw:"Kog’Maw",Leblanc:'LeBlanc',LeeSin:'Lee Sin',MasterYi:'Master Yi',MissFortune:'Miss Fortune',MonkeyKing:'Wukong',Nunu:'Nunu & Willump',RekSai:"Rek’Sai",Renata:'Renata Glasc',TahmKench:'Tahm Kench',TwistedFate:'Twisted Fate',Velkoz:"Vel’Koz",XinZhao:'Xin Zhao'};
export const FALLBACK = [...new Set(Object.values(groups).join(' ').split(' '))].map(key=>({id:key==='Wukong'?'MonkeyKing':key,name:names[key]||key,roles:ROLES.filter(r=>groups[r].split(' ').includes(key))}));
export const DD = 'https://ddragon.leagueoflegends.com';
export const DEFAULT_VERSION = '16.23.1';
export function icon(id, version=DEFAULT_VERSION) {return `${DD}/cdn/${version}/img/champion/${id}.png`;}
