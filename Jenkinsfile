// CI/CD for the FastAPI backend on a DigitalOcean droplet.
// Jenkins runs on the same droplet and deploys via docker compose.
//
// Prereqs on the droplet (see infra/droplet/setup.sh):
//   - docker + compose plugin; the `jenkins` user is in the `docker` group
//   - /etc/deg/api.env      (app secrets)
//   - /etc/deg/deploy.env   (API_DOMAIN=<ip>.nip.io)
pipeline {
  agent any
  options {
    timestamps()
    disableConcurrentBuilds()
  }
  stages {
    stage('Checkout') {
      steps { checkout scm }
    }

    stage('Unit tests') {
      steps {
        // Run the DB-free unit suite in a throwaway python container.
        sh '''
          docker run --rm -v "$PWD/backend":/w -w /w python:3.11-slim \
            sh -c "pip install -q -r requirements.txt && \
                   python -m pytest tests/test_pipelines_unit.py -q"
        '''
      }
    }

    stage('Deploy') {
      steps {
        sh '''
          set -a; . /etc/deg/deploy.env; set +a
          docker compose -f docker-compose.prod.yml up -d --build
          docker image prune -f
        '''
      }
    }

    stage('Smoke test') {
      steps {
        sh '''
          set -a; . /etc/deg/deploy.env; set +a
          echo "Waiting for https://$API_DOMAIN/api/health ..."
          for i in $(seq 1 30); do
            if curl -fsS "https://$API_DOMAIN/api/health" | grep -q '"ok":true'; then
              echo "Healthy."; exit 0
            fi
            sleep 5
          done
          echo "Health check did not pass in time"; exit 1
        '''
      }
    }
  }
  post {
    success { echo '✅ Deployed and healthy.' }
    failure { echo '❌ Pipeline failed — see stage logs.' }
  }
}
