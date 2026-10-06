// Shinatal — script das páginas estáticas (privacidade.html e 404.html; antes inline, extraído
// para a CSP poder proibir script inline — ver firebase.json).
import { ativarRevelacaoAoRolar, sincronizarAlturaHeader } from "./ui-utils.js";
ativarRevelacaoAoRolar();
sincronizarAlturaHeader();
