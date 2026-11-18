# Documentação do Shinatal

Toda a documentação do projeto, organizada por assunto. Comece pela [arquitetura](ARQUITETURA.md) se você é novo no código.

```text
docs/
├── README.md              Este índice
├── ARQUITETURA.md         Visão técnica com diagramas
├── guias/                 Como instalar, configurar e publicar
├── regras/                Regulamento e regras de cálculo (fonte de verdade do negócio)
├── qualidade/             Acessibilidade e auditoria de qualidade
├── conformidade/          LGPD e tratamento de dados pessoais
├── seguranca/             Auditorias de segurança
└── imagens/               Imagens usadas na documentação
```

## Arquitetura

| Documento | Conteúdo |
|---|---|
| [ARQUITETURA.md](ARQUITETURA.md) | Contexto, camadas, modelo de dados, motor de cálculo, fluxos, segurança, deploy, testes e decisões |

## Guias

| Documento | Conteúdo |
|---|---|
| [guias/SETUP.md](guias/SETUP.md) | Firebase, regras, contas especiais, Turnstile, App Check e publicação |
| [guias/REQUIREMENTS.md](guias/REQUIREMENTS.md) | Pré-requisitos de ambiente para o portal e os scripts |

## Regras de negócio

| Documento | Conteúdo |
|---|---|
| [regras/Regulamento_Interno_Shinatal.pdf](regras/Regulamento_Interno_Shinatal.pdf) | Regulamento interno do programa: a fonte de verdade das regras de premiação |
| [regras/Regras_de_Calculo_Shinatal.pdf](regras/Regras_de_Calculo_Shinatal.pdf) | Régua de meses v2 e cálculo dos contratos, com exemplos |

## Qualidade

| Documento | Conteúdo |
|---|---|
| [qualidade/ACESSIBILIDADE.md](qualidade/ACESSIBILIDADE.md) | Critérios WCAG 2.2 AA, ABNT NBR 17225 e eMAG atendidos, e como auditar |

## Conformidade

| Documento | Conteúdo |
|---|---|
| [conformidade/LGPD.md](conformidade/LGPD.md) | Dados tratados, bases legais, retenção e atendimento ao titular |

## Segurança

| Documento | Conteúdo |
|---|---|
| [../SECURITY.md](../SECURITY.md) | Política de segurança, o que nunca versionar e como reportar |
| [seguranca/auditoria-firestore-2026-09.md](seguranca/auditoria-firestore-2026-09.md) | Auditoria das regras do Firestore e do Firebase Auth, com plano de remediação |

## Convenções

- Documentos em português, em Markdown, com diagramas em [Mermaid](https://mermaid.js.org/) (o GitHub mostra direto).
- Nada de senha, chave, token, e-mail de conta privilegiada ou dado pessoal real na documentação. Exemplos usam dados fictícios.
- Material interno (prompts, rascunhos, anotações) fica em `.privado/`, que está fora do Git.
