# Resolver npm no PATH no Windows

## 1. Verificar se o Node.js esta instalado

Abra o PowerShell e rode:

```powershell
where.exe node
where.exe npm
node -v
npm -v
```

Se `node` aparece, mas `npm` nao aparece, o Node disponivel pode ser apenas o runtime embutido de outro aplicativo. Nesse caso, instale o Node.js oficial.

## 2. Instalar Node.js oficial

1. Acesse:

```txt
https://nodejs.org/
```

2. Baixe a versao LTS para Windows.
3. Durante a instalacao, mantenha marcada a opcao de adicionar ao `PATH`.
4. Feche e abra novamente o PowerShell.
5. Rode:

```powershell
node -v
npm -v
```

## 3. Se instalou, mas npm ainda nao aparece

Confira se esta pasta existe:

```txt
C:\Program Files\nodejs\
```

Depois confira o PATH do usuario:

```powershell
[Environment]::GetEnvironmentVariable("Path", "User")
```

E o PATH da maquina:

```powershell
[Environment]::GetEnvironmentVariable("Path", "Machine")
```

O PATH deve conter:

```txt
C:\Program Files\nodejs\
```

Se nao contiver, adicione manualmente:

1. Abra o menu Iniciar.
2. Pesquise por `variaveis de ambiente`.
3. Abra `Editar as variaveis de ambiente do sistema`.
4. Clique em `Variaveis de Ambiente`.
5. Em `Path`, adicione:

```txt
C:\Program Files\nodejs\
```

6. Feche e abra o PowerShell novamente.

## 4. Validacao final

Dentro da pasta do projeto:

```powershell
cd "C:\Users\Usuario\Documents\CMV Loja"
node -v
npm -v
```

Quando os dois comandos responderem versoes, o ambiente esta pronto.
