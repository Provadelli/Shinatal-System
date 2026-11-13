# LGPD no Shinatal

Como o sistema atende à Lei Geral de Proteção de Dados (Lei 13.709/2018) e o que a empresa
precisa manter. Os textos para o colaborador estão em `frontend/privacidade.html` (Política de
Privacidade) e `frontend/termos.html` (Termos de Uso).

- **Controladora:** Shine Rio Serviços Ltda.
- **Encarregado (art. 41):** Presidente da Shine Rio — shinerio@shinerio.com
- **Versão vigente dos termos:** `VERSAO_TERMOS` em `frontend/js/lgpd-config.js`

## O que o sistema faz

| Requisito | Como |
|---|---|
| Transparência (art. 6º, VI; art. 9º) | Política de Privacidade e Termos de Uso, com versão e data, ligados no rodapé de todas as páginas. |
| Aceite registrado | Caixa obrigatória no cadastro. O aceite fica em `usuarios/{uid}.aceiteTermos = { versao, aceitoEm }`, com a hora do servidor. |
| Quem não aceitou | Contas antigas, convidados pelo Admin e todos depois de uma nova versão veem um diálogo bloqueante no login (`js/consentimento.js`): só seguem aceitando ou saindo. |
| Prova do aceite | As `firestore.rules` só deixam o próprio titular gravar o aceite, com `aceitoEm == request.time`. Nem Admin nem Presidente gravam ou apagam o aceite de outra pessoa. |
| Acesso e portabilidade (art. 18, II e V) | Perfil → "Meus dados" → **Baixar meus dados** (PDF no papel timbrado da Shine Rio com perfil, faltas, atrasos, advertências, avaliações, contratos e votos de conduta). |
| Consentimento da foto (art. 8º, §5º) | Foto opcional. **Remover minha foto** no Perfil revoga na hora. |
| Demais direitos | Link de e-mail ao Encarregado com assunto pronto (Perfil → "Pedir correção ou exclusão"). |
| Segurança (art. 46) | Acesso por papel nas `firestore.rules` (testadas em `backend/tests/rules`), e-mail institucional confirmado, CSP estrita, App Check, Turnstile, histórico das ações da gestão. |
| Sem rastreamento | Nenhum cookie de publicidade ou analytics. No navegador ficam só a sessão, a preferência de pausar animações e cookies técnicos antirrobô. Por isso não há banner de cookies. |

## Registro das operações de tratamento (art. 37)

| Dados | Finalidade | Base legal | Quem acessa | Operadores | Retenção |
|---|---|---|---|---|---|
| Cadastro (nome, cargo, e-mail, jornada, admissão) | Identificar o colaborador e calcular o peso no fundo | Contrato de trabalho (art. 7º, V) | Titular; DP/RH/Admin/Presidente | Google Firebase | Vínculo + 5 anos |
| Foto | Identificação visual no sistema | Consentimento (art. 7º, I) | Titular; gestão | Google Firebase | Até remover ou fim do vínculo |
| Faltas, atrasos, advertências, avaliações | Regras do Regulamento Interno | Contrato; obrigação legal (art. 7º, V e II) | Titular; gestão | Google Firebase | Vínculo + 5 anos |
| Cota calculada | Pagamento do Shinatal | Contrato (art. 7º, V) | Titular; gestão | — (calculada no navegador) | Não é guardada; recalculada |
| Votos de conduta | Avaliação social entre colegas (não entra na cota) | Legítimo interesse (art. 7º, IX) | Só o autor vê o próprio voto; contagem anônima ao avaliado e à gestão | Google Firebase | Vínculo |
| Diretório (primeiro nome, cargo, papel) | Colegas se encontrarem na avaliação de conduta | Legítimo interesse | Colaboradores logados | Google Firebase | Vínculo |
| Histórico de ações da gestão | Auditoria e prestação de contas | Legítimo interesse; exercício de direitos (art. 7º, IX e VI) | Admin/Presidente | Google Firebase | 5 anos |
| Aceite dos termos | Prova do aceite | Contrato; obrigação legal | Titular; gestão | Google Firebase | Vínculo + 5 anos |
| IP, navegador, token antirrobô | Segurança do login e do cadastro | Legítimo interesse | Operadores | Google (Firebase, reCAPTCHA), Cloudflare (Turnstile, Workers) | Conforme cada operador |

## Trocar a versão dos termos

1. Edite `frontend/termos.html` e/ou `frontend/privacidade.html` e atualize a linha "Versão … · em vigor desde …".
2. Troque `VERSAO_TERMOS` em `frontend/js/lgpd-config.js` para a nova data (ex.: `"2027-03-01"`).
3. Publique. No próximo login, todo mundo verá "Atualizamos nossos termos" e precisará aceitar de novo.

Trocar só o texto sem trocar a versão **não** pede novo aceite. Use isso só para correções que não
mudam o sentido.

## Pedido de titular (prazo: 15 dias, art. 19, II)

1. O pedido chega ao Encarregado (shinerio@shinerio.com). Confirme que veio do e-mail institucional da pessoa.
2. **Acesso/cópia:** oriente a usar Perfil → "Baixar meus dados", ou gere a cópia pelo console do Firebase.
3. **Correção:** Admin/Presidente corrige pelo painel de gestão (nome, cargo, jornada, admissão) ou o DP/RH corrige o lançamento.
4. **Exclusão:** antes de excluir, confira se há obrigação de guarda (vínculo ativo ou até 5 anos após o desligamento). Se houver, responda explicando o motivo e o prazo. Se não houver, exclua o perfil (painel de gestão), os lançamentos e a conta de Auth (`backend/scripts/excluir-usuario.js`).
5. **Revisão do cálculo da cota (art. 20):** uma pessoa da gestão confere o cálculo com o Regulamento Interno e responde.
6. Registre o pedido e a resposta (data, o que foi feito).

## Incidente de segurança (art. 48)

1. Conter: revogar acessos e chaves comprometidas, trocar senhas, desativar a conta envolvida.
2. Avaliar: quais dados, de quem, quantas pessoas, que risco.
3. Se houver risco ou dano relevante: comunicar a **ANPD** (formulário em gov.br/anpd) e os **titulares afetados** em até **3 dias úteis**, conforme o Regulamento de Comunicação de Incidentes da ANPD (Resolução CD/ANPD nº 15/2024).
4. Registrar o incidente, mesmo os que não precisem ser comunicados.

## Pendências da empresa (fora do código)

- [ ] Incluir **CNPJ e endereço** da Shine Rio no item 1 da Política de Privacidade.
- [ ] Aceitar ou guardar os **termos de tratamento de dados (DPA)** do Google Cloud/Firebase e da Cloudflare, que dão base à transferência internacional (art. 33).
- [ ] Confirmar a **região do Firestore** no console do Firebase e, se for no Brasil (`southamerica-east1`), ajustar o item 4 da política.
- [ ] Nomear formalmente o Encarregado (ato interno) e divulgar o contato no site institucional da empresa.
- [ ] Orientar DP, RH e Admin sobre sigilo dos dados de colegas e sobre este roteiro.
- [ ] Revisão jurídica dos textos da Política e dos Termos.
